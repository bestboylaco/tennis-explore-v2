# Demo script

Ordered to build from simple to complex, with each step mapped to something the
partner asked for. Roughly 10 minutes.

**Run it through once privately first.** Some of these will land better than
others depending on what made it into the index — drop the ones that don't, keep
the ones that do. A demo of eight things that work beats twelve where three
stumble.

Start at <http://localhost:3000>, role set to **Admin**.

---

## Act 1 — a simple lookup, with a real citation

> **Who were the authors of the first Cardio Tennis publication, and what year was it published?**

*Al's test question 7.* Single-hop. Watch for: a short answer, a `[n]` marker, and
one source chip naming the paper and page.

> **How many female tennis players were recruited in the Whiteside 2013 serve study?**

*Al's test question 12.* Same shape, a specific number.

**What this shows:** *"reference where the information has come from, so that the
user can follow and inspect the exact trail."*

---

## Act 2 — the citation trail

**Click the source chip.**

The panel opens on the right at the **cited page** — not page 1 of a 40-page
paper. The conversation stays exactly where it was behind it. Press Escape to
close.

**What this shows:** *"Clicking on the link would open the asset, but not take
them away from or lose the chat function spot."*

Point out the metadata under the title: filename, authors, date, classification.
The filename is there because title extraction from arbitrary PDFs is a best
effort — the filename always identifies the document exactly.

---

## Act 3 — structured, single entity

> **What is Carlos Alcaraz's best ranking in the match data?**

This is Al's own example — *"provide a simple answer if it's a quick question,
like 'what is Player X's best ranking'."*

Note the routing line: **analytical · structured**. It did not search documents;
it looked the value up in a record.

**What this shows:** *"if it is a direct question from a single-entity query then
return the precise lookup from a record, and provide the resource link too."*

---

## Act 4 — aggregation and comparison

> **How many matches were played on each surface?**

> **Compare wins and losses on hard courts versus clay.**

Both return a sentence, **a table**, and **the SQL that produced it**.

Worth saying out loud: *no chunk in the index contains these counts.* Nobody ever
wrote them down. Retrieval fundamentally cannot answer this — the numbers are
computed from the rows at query time.

And: **the model never wrote that SQL.** It filled in a validated specification —
table, filters, groupBy, metrics — checked against the real schema before
anything ran. The SQL shown is rendered afterwards so the number can be audited.

**What this shows:** *"If it is a trend, comparison or aggregation question …
provide a side by side table or graph"* and the **Code/SQL** output format.

---

## Act 5 — summarisation

> **Summarise what we know about lumbar stress injuries in junior players.**

Expect several short paragraphs grouped **by theme, not by document**, each
carrying its own citation, drawing on multiple slides and papers.

**What this shows:** *"questions that ask for summarisation and aggregation of
large amounts of unstructured assets, where the response should be more like
concise executive summaries and overviews."*

---

## Act 6 — multi-hop

> **What does the research say about accelerometer load in matches compared with training, and how does the Catapult programme apply it?**

Two separate lookups joined: a finding from the research, and a recommendation
from the programme deck. Check the sources list — it should cite **more than one
document**.

**What this shows:** the **Multi-Hop** input type from Al's taxonomy.

---

## Act 7 — the refusals

This is the most important part of the demo, and the easiest to skip.

> **What was Novak Djokovic's serve speed at the 2019 Australian Open final?**

> **What was the highest beep test result in the national strength and conditioning data up to 26/08/2014?**

Both should return: *"The knowledge base does not contain an answer to this
question."*

Say why the first one matters: the model **knows** this from its training data.
It is plausible, specific, and absent from the corpus — exactly the kind of
question these systems answer confidently and wrongly. Ours checks whether the
question's proper nouns and years appear anywhere in the retrieved evidence.
"Djokovic" and "2019" appear nowhere, so it refuses before generating anything.

The second is Al's test question 10, and it is a genuine gap — that data has not
been supplied. Refusing is the correct answer today.

**What this shows:** *"We also want to have clear responses that state that the
answer doesn't seem to exist in the knowledge base and doesn't hallucinate."*

---

## Act 8 — access control

> **Athlete heart rate monitoring**

Ask it as **Admin**. Confidential match records with heart-rate data appear.

Now switch the role selector to **Analyst** and ask the identical question. Those
records are gone.

The filter runs *inside* both retrieval arms, before either produces a ranked
list — never as a post-filter, which would let a forbidden chunk take a slot and
then get dropped, silently shortening the result set.

**What this shows:** the classification model working end to end, and that it is
enforced rather than merely described.

---

## Act 9 — the third content type

> **Find footage of a defensive to offensive transition.**

The citation opens the clip at the cited second, not at the start.

**What this shows:** documents, records and video reachable through one question.

---

## If someone asks

**"Is it using ChatGPT?"** No. Everything runs locally through Ollama. No athlete
data leaves the machine, which the partner's own information security policy
would require.

**"How does it know which documents to use?"** Two retrievers run in parallel —
keyword matching for exact terms, and embeddings for meaning — and their results
are fused by rank position rather than score. Then a reranker reads the question
against each passage.

**"Why is it slow?"** It is doing retrieval, relevance grading, reranking and
generation on a consumer GPU. A production deployment would use a served model
with batching.

**"How much of the document does it read?"** Never a whole document. Around
12,000 characters — the most relevant paragraphs from across several sources.

**"How big is the corpus?"** 99,496 chunks from 2,599 files.
