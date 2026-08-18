// the whole answer path, in one place.
//
//   plan  ->  gather  ->  compose  ->  verify  ->  shape
//
// each stage is a separate module; this file only decides the order and what
// happens when a stage comes back empty. the reason it is worth having as its
// own file is that "what happens when a stage comes back empty" is most of the
// product: al's clearest requirement was that the assistant says it does not
// know rather than inventing something, and that behaviour lives here, not in
// the prompt.

import { retrievalConfig } from "../../../config/retrieval.config.js";
import { CONTRACTS, ROUTES } from "../../../shared/constants/queryTaxonomy.js";
import { grantsForRole } from "../../../shared/constants/accessControl.js";
import { planQuery } from "../../query/queryPlanner.service.js";
import { retrieve } from "../../retrieval/retrieval.service.js";
import { bindCitations, findUnsupportedNumbers } from "../../retrieval/citation.service.js";
import { buildContext } from "../../retrieval/contextBuilder.service.js";
import { buildAssetLink } from "../../retrieval/assetLink.service.js";
import {
  ABSTENTION_SENTENCE,
  buildContractPayload,
  buildSystemPrompt,
  isAbstention,
  renderMarkdownTable,
} from "../../retrieval/answerContract.service.js";
import { getTables, visibleTables } from "../../structured/tableStore.service.js";
import { GRADES, gradeEvidence } from "../../generation/evidenceGrader.service.js";
import { prepareEvidence } from "../../generation/contextOrdering.service.js";
import { fewShotMessages } from "../../generation/fewShot.service.js";
import { verifyAnswer } from "../../generation/verifier.service.js";
import { buildQuerySpec } from "../../structured/specPlanner.service.js";
import { runQuery } from "../../structured/queryEngine.service.js";
import { AUDIT_QUERY_KINDS } from "../../../shared/constants/audit.js";
import { recordAccess, recordAccessDenial } from "../../audit/services/accessAuditRecorder.service.js";

export class ModelUnavailableError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "ModelUnavailableError";
    this.code = "MODEL_UNAVAILABLE";
    this.statusCode = 503;

    if (cause) this.cause = cause;
  }
}

async function generate(systemPrompt, userContent, { signal, examples = [] }) {
  let response;

  try {
    response = await fetch(`${retrievalConfig.generation.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: retrievalConfig.generation.model,
        stream: false,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: systemPrompt },
          // worked examples sit between the instructions and the real question.
          // a demonstrated pattern is followed far more reliably than a
          // described one, especially for citation format and for refusing.
          ...examples,
          { role: "user", content: userContent },
        ],
      }),
      signal,
    });
  } catch (error) {
    // a bare "fetch failed" tells nobody anything. this is far and away the most
    // common thing to go wrong on a fresh machine -- ollama simply is not
    // running -- so the message should say that and say how to fix it.
    throw new ModelUnavailableError(
      `Could not reach the language model at ${retrievalConfig.generation.baseUrl}.\n` +
        `  Is Ollama running?   ollama serve\n` +
        `  Is the model pulled? ollama pull ${retrievalConfig.generation.model}`,
      { cause: error },
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");

    throw new ModelUnavailableError(
      `The language model returned ${response.status}. ` +
        `${response.status === 404 ? `Pull it first: ollama pull ${retrievalConfig.generation.model}` : body.slice(0, 200)}`,
    );
  }

  const payload = await response.json();

  return String(payload.message?.content ?? "").trim();
}

/**
 * the response we return when we genuinely cannot answer.
 *
 * this is built here rather than asked of the model, because the one thing that
 * must never happen is the model improvising in the exact situation where it has
 * nothing to improvise from. no model call is made at all.
 */
function abstain({ plan, roleId, reason, cause = "not_found", startedAt }) {
  return {
    answered: false,
    answer:
      cause === "access_denied"
        ? `Your role ("${roleId}") does not have access to the data needed to answer this.`
        : ABSTENTION_SENTENCE,
    reason,
    cause,
    citations: [],
    contracts: plan.contracts,
    intent: plan.intent,
    route: plan.route,
    grounding: { grounded: false, danglingCitations: [], unsupportedNumbers: [], abstained: true },
    telemetry: { roleId, intent: plan.intent, route: plan.route, durationMs: Date.now() - startedAt },
  };
}

// ---------------------------------------------------------------------------
// the unstructured path
// ---------------------------------------------------------------------------

async function answerFromDocuments(plan, { roleId, signal, startedAt, correlationId }) {
  const retrieval = await retrieve(plan.question, {
    roleId,
    // retrieve wider than we will show. grading and deduplication both remove
    // material, and starting at exactly topN means ending up below it.
    topN: Math.ceil(plan.topN * 1.8),
    signal,
    subQueries: plan.subQuestions,
  });

  if (retrieval.evidence.length === 0) {
    const reason = `nothing in the knowledge base is both relevant and visible to the role "${roleId}"`;

    await recordAccessDenial({
      correlationId,
      roleId,
      queryKind: AUDIT_QUERY_KINDS.DOCUMENT,
      reason,
    });

    return abstain({ plan, roleId, reason, startedAt });
  }

  // ---- grade before generating (corrective rag) ---------------------------
  //
  // retrieval always returns something. asked about a document we do not hold,
  // it returns ten irrelevant chunks, and a model handed ten irrelevant
  // passages writes a confident wrong answer rather than refusing -- because
  // from where it sits, ten real passages about tennis look like grounds to
  // answer. so we check first.
  const graded = await gradeEvidence(plan.question, retrieval.evidence, { signal });

  if (graded.grade === GRADES.INSUFFICIENT) {
    return {
      ...abstain({
        plan,
        roleId,
        reason: `the retrieved material does not address this question (${graded.reason})`,
        startedAt,
      }),
      grading: graded,
    };
  }

  // ---- shape what the model reads -----------------------------------------
  const prepared = prepareEvidence(graded.kept, plan.question, {
    maxChars: retrievalConfig.generation.maxContextChars,
    topN: plan.topN,
  });

  const evidence = prepared.evidence;

  const context = evidence
    .map((chunk) => {
      const source = [
        chunk.title,
        chunk.file_name,
        chunk.section ? `section: ${chunk.section.replace(/_/g, " ")}` : null,
        chunk.page ? `page ${chunk.page}` : null,
        chunk.authors?.length ? chunk.authors.slice(0, 3).join(", ") : null,
        chunk.event_date ?? null,
      ]
        .filter(Boolean)
        .join(" | ");

      return `[${chunk.citationNumber}] (${source})\n${chunk.text}`;
    })
    .join("\n\n");

  // Audited here, right before the evidence crosses into the prompt -- this
  // is the exact boundary E5-19's acceptance criterion needs proof against
  // ("a restricted document was never sent to the model"). A generation
  // failure after this point does not un-audit the exposure: the role saw
  // this content regardless of whether the model answered.
  await recordAccess({
    correlationId,
    roleId,
    queryKind: AUDIT_QUERY_KINDS.DOCUMENT,
    documents: evidence.map((chunk) => ({
      docId: chunk.doc_id,
      chunkId: chunk.chunk_id,
      title: chunk.title,
      sourceType: chunk.source_type,
      dataDomain: chunk.data_domain,
      sensitivity: chunk.sensitivity,
      program: chunk.program,
      citationNumber: chunk.citationNumber,
    })),
  });

  const answer = await generate(
    buildSystemPrompt(plan),
    `Evidence:\n${context}\n\nQuestion: ${plan.question}`,
    {
      signal,
      examples: retrievalConfig.generation.fewShotEnabled ? fewShotMessages(plan.intent) : [],
    },
  );

  // ---- check what came back ------------------------------------------------
  const abstained = isAbstention(answer);
  const verification = verifyAnswer(answer, evidence);

  const citations = verification.citations.map((citation) => {
    const chunk = evidence.find((candidate) => candidate.chunk_id === citation.chunkId);

    const link = chunk ? buildAssetLink(chunk) : null;

    return {
      ...citation,
      link,
      // alias, for the same reason as `excerpt` in citation.service.
      url: link?.href ?? null,
      // when the corpus holds several copies of a document, say so. it is the
      // difference between one source and four, and it looks like corroboration
      // if you do not mention it.
      alsoAppearsIn: chunk?.duplicateOf?.length ? chunk.duplicateOf : undefined,
    };
  });

  const payload = buildContractPayload({ contracts: plan.contracts, answer, citations });

  return {
    answered: !abstained,
    ...payload,
    citations,
    intent: plan.intent,
    route: plan.route,
    grading: { grade: graded.grade, reason: graded.reason, droppedAsIrrelevant: graded.dropped ?? 0 },
    grounding: {
      grounded: verification.grounded && !abstained,
      citedFraction: verification.citedFraction,
      danglingCitations: verification.danglingCitations,
      unusedEvidence: verification.unusedEvidence,
      unsupportedNumbers: verification.unsupportedNumbers,
      warnings: verification.warnings,
      abstained,
    },
    telemetry: {
      roleId,
      intent: plan.intent,
      route: plan.route,
      planSource: plan.planSource,
      ...retrieval.telemetry,
      evidenceGrade: graded.grade,
      duplicatesRemoved: prepared.duplicatesRemoved,
      compressedChunks: prepared.compressedCount,
      droppedForLength: prepared.droppedForLength,
      contextChars: prepared.chars,
      itemsOut: evidence.length,
      durationMs: Date.now() - startedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// the structured path
// ---------------------------------------------------------------------------

async function answerFromTables(plan, { roleId, signal, startedAt, correlationId }) {
  const grants = grantsForRole(roleId);
  const allTables = await getTables();
  const tables = visibleTables(allTables, grants);
  const hiddenCount = allTables.length - tables.length;

  if (tables.length === 0) {
    const reason = `no tables are visible to the role "${roleId}"`;

    await recordAccessDenial({ correlationId, roleId, queryKind: AUDIT_QUERY_KINDS.TABLE, reason });

    return abstain({ plan, roleId, reason, cause: "access_denied", startedAt });
  }

  const built = await buildQuerySpec(plan.question, tables, { signal });

  if (built.unanswerable) {
    // the distinction that matters here: "no table holds this" versus "no table
    // YOU CAN SEE holds this". they look identical from inside the planner,
    // because it was only ever shown the visible tables.
    //
    // if anything was hidden from this role, we report it as an access boundary
    // rather than as absence. that is deliberately cautious -- it will
    // occasionally say "you may not have access" about a question no table could
    // answer anyway. that error is much cheaper than the alternative, which is
    // silently answering a different question from a research paper and leaving
    // the coach with no idea the match data even exists.
    const reason =
      hiddenCount > 0
        ? `${built.reason}. ${hiddenCount} table(s) are not visible to the role "${roleId}" and may hold it.`
        : built.reason;
    const cause = hiddenCount > 0 ? "access_denied" : "not_found";

    if (cause === "access_denied") {
      await recordAccessDenial({ correlationId, roleId, queryKind: AUDIT_QUERY_KINDS.TABLE, reason });
    }

    return abstain({ plan, roleId, reason, cause, startedAt });
  }

  let result;

  try {
    result = runQuery(built.spec, built.table);
  } catch (error) {
    return abstain({ plan, roleId, reason: `the query could not be run: ${error.message}`, startedAt });
  }

  // Audited once here rather than at each return below: both the
  // zero-rows-matched response and the generated one expose the same table
  // to the role, and a query that reaches this line has already crossed the
  // access-control boundary either way.
  await recordAccess({
    correlationId,
    roleId,
    queryKind: AUDIT_QUERY_KINDS.TABLE,
    documents: [{ docId: result.table, title: result.tableTitle, sourceType: "table" }],
  });

  if (result.rowsMatched === 0) {
    // an empty result is a real answer -- "there are no matches on grass in this
    // data" -- and it is important not to dress it up as a failure or, worse,
    // let the model invent rows to fill the table.
    return {
      answered: true,
      answer:
        `No rows in ${result.tableTitle} match that question. ` +
        `The table holds ${result.rowsScanned} rows in total.`,
      citations: [tableCitation(result, built)],
      contracts: plan.contracts,
      intent: plan.intent,
      route: plan.route,
      table: { columns: result.columns, rows: [], markdown: "_No rows matched._" },
      data: { columns: result.columns, rows: [], rowsScanned: result.rowsScanned, rowsMatched: 0 },
      sql: result.sql,
      grounding: { grounded: true, danglingCitations: [], unsupportedNumbers: [], abstained: false },
      telemetry: { roleId, intent: plan.intent, route: plan.route, ...queryTelemetry(result), durationMs: Date.now() - startedAt },
    };
  }

  // the model never sees the raw table. it sees the computed result and is asked
  // to describe it, which removes any opportunity to do arithmetic of its own --
  // the single most common way a structured answer goes wrong.
  const answer = await generate(
    buildSystemPrompt(plan),
    `Result of the query (already computed, do not recalculate):\n\n` +
      `${renderMarkdownTable(result.columns, result.rows)}\n\n` +
      `Rows scanned: ${result.rowsScanned}. Rows matched: ${result.rowsMatched}.\n` +
      `Source table: ${result.tableTitle}\n\nQuestion: ${plan.question}`,
    {
      signal,
      examples: retrievalConfig.generation.fewShotEnabled ? fewShotMessages(plan.intent) : [],
    },
  );

  const citation = tableCitation(result, built);

  const payload = buildContractPayload({
    contracts: plan.contracts,
    answer,
    structuredResult: result,
    citations: [citation],
  });

  return {
    answered: !isAbstention(answer),
    ...payload,
    citations: [citation],
    intent: plan.intent,
    route: plan.route,
    grounding: {
      grounded: true,
      danglingCitations: [],
      // every number in a structured answer traces to the computed result, so
      // the check is against the table rather than against retrieved prose.
      unsupportedNumbers: findUnsupportedNumbers(answer, [
        { text: JSON.stringify(result.rows) + ` ${result.rowsScanned} ${result.rowsMatched}` },
      ]),
      abstained: false,
    },
    telemetry: {
      roleId,
      intent: plan.intent,
      route: plan.route,
      planSource: plan.planSource,
      ...queryTelemetry(result),
      durationMs: Date.now() - startedAt,
    },
  };
}

function tableCitation(result, built) {
  return {
    number: 1,
    chunkId: null,
    docId: result.table,
    title: result.tableTitle,
    sourceType: "table",
    quote: null,
    sql: result.sql,
    link: buildAssetLink({
      doc_id: result.table,
      title: result.tableTitle,
      modality: "record",
      source_uri: result.sourceUri,
      row_id: null,
    }),
    // what the number rests on. a median over 4 rows and a median over 4000
    // deserve different amounts of trust, and the citation should say which.
    basis: { rowsScanned: result.rowsScanned, rowsMatched: result.rowsMatched },
  };
}

function queryTelemetry(result) {
  return {
    table: result.table,
    rowsScanned: result.rowsScanned,
    rowsMatched: result.rowsMatched,
    rowsReturned: result.rowsReturned,
  };
}

// ---------------------------------------------------------------------------
// public entry point
// ---------------------------------------------------------------------------

/**
 * answers one question.
 *
 * roleId is required and has no default, for the same reason as in retrieval:
 * a default means forgetting to pass one still returns data.
 */
export async function answerQuestion(question, { roleId, signal = null, correlationId = null } = {}) {
  if (typeof question !== "string" || question.trim() === "") {
    throw new Error("answerQuestion requires a non-empty question.");
  }

  if (!roleId) {
    throw new Error("answerQuestion requires a roleId. there is no default role on purpose.");
  }

  const startedAt = Date.now();
  const plan = await planQuery(question, { signal });

  if (plan.route === ROUTES.STRUCTURED) {
    const structured = await answerFromTables(plan, { roleId, signal, startedAt, correlationId });

    if (structured.answered) return structured;

    // a structured question the tables cannot answer is often answerable from
    // the documents -- "how many junior ITF matches do top 10 players average at
    // 15" sounds like a table query and is actually a finding in a paper. so we
    // fall through rather than abstaining immediately.
    //
    // but NOT when the reason was access. if the caller may not see the match
    // records, quietly answering from a research paper instead means they asked
    // about their squad's results and got a sentence about a study, with nothing
    // saying why. worse, it hides the access boundary from them. an access
    // refusal is a real answer and it must survive.
    if (structured.cause === "access_denied") return structured;

    const fallback = await answerFromDocuments(plan, { roleId, signal, startedAt, correlationId });

    if (fallback.answered) {
      fallback.telemetry.fellBackFrom = ROUTES.STRUCTURED;
      fallback.telemetry.structuredReason = structured.reason;
      return fallback;
    }

    return structured;
  }

  return answerFromDocuments(plan, { roleId, signal, startedAt, correlationId });
}

export { CONTRACTS, ROUTES };
