# TennisExplore — how it works

Written for a non-technical reader. No code, no jargon that isn't explained.

> **Viewing these diagrams:** they render automatically on GitHub. In VS Code,
> install the "Markdown Preview Mermaid Support" extension and press
> `Ctrl+Shift+V`. Or paste any block into <https://mermaid.live> to get an
> image for a slide deck.

---

## The one-sentence version

Tennis Australia has thousands of documents, presentations and recordings that
nobody can search properly. This turns all of it — including the things that
aren't text, like scanned pages, charts and video — into something you can ask
a question of in plain English, and get an answer that tells you exactly which
document, page or moment it came from.

---

## Part 1 — When new material arrives

```mermaid
flowchart TB
    subgraph ARRIVE["① Something new arrives"]
        S3[("S3 bucket<br/>where everything lives")]
        EVENT["S3 announces it<br/>'a new file just landed'"]
        WORKER["A worker picks it up<br/>and opens it"]
        S3 --> EVENT --> WORKER
    end

    WORKER --> SORT{"What kind<br/>of file is it?"}

    subgraph LANES["② Each type gets what it needs"]
        direction LR
        A["<b>Normal PDF</b><br/>Text is already inside.<br/>Just read it.<br/><br/><i>2,117 files</i>"]
        B["<b>Scanned PDF</b><br/>A photograph of a page.<br/>Software reads the<br/>letters off the image.<br/><br/><i>180 files</i>"]
        C["<b>Slide deck</b><br/>Words come out easily,<br/>but the charts are<br/>pictures — so a model<br/>describes each one.<br/><br/><i>292 decks</i>"]
        D["<b>Video</b><br/>Two passes: what was<br/>said, and what was on<br/>the screen behind them.<br/><br/><i>23 recordings</i>"]
        E["<b>Spreadsheet</b><br/>Kept as a real table so<br/>totals and averages are<br/>calculated, not guessed.<br/><br/><i>4 files</i>"]
    end

    SORT --> A & B & C & D & E

    subgraph COMMON["③ From here it is all just text"]
        CHUNK["Cut into passages<br/>about a paragraph each<br/><b>~99,000 passages</b>"]
        LABEL["Label every passage<br/>which document, page, author,<br/>date, and who may see it"]
        EMBED["Turn meaning into numbers<br/>each passage becomes a list<br/>of 1,024 numbers"]
        CHUNK --> LABEL --> EMBED
    end

    A & B & C & D & E --> CHUNK
    EMBED --> KB[("<b>The knowledge base</b><br/>searchable by meaning<br/>AND by exact words")]

    style ARRIVE fill:#eef4fb,stroke:#4a7fd9
    style LANES fill:#f6f4ee,stroke:#c9a227
    style COMMON fill:#eef7ef,stroke:#4a8a52
    style KB fill:#fff,stroke:#4a8a52,stroke-width:3px
    style SORT fill:#fff,stroke:#c9a227,stroke-width:2px
```

### Why "turn meaning into numbers" matters

A computer can't tell that *"stopping kids hurting their backs"* and *"lumbar
bone stress injury prevention"* are the same topic — they share no words.

So every passage is converted into a list of 1,024 numbers that represents its
**meaning**. Passages about similar things end up with similar numbers, even
when the words are completely different. That's what makes it possible to find
the right paper without knowing the exact phrase the researcher used.

---

## Part 2 — What a production system would add

We built the thinking. A live deployment changes the plumbing around it.

```mermaid
flowchart LR
    subgraph NOW["What we run today"]
        N1["A person types<br/>one command"]
        N2["Knowledge base is<br/>a set of files kept<br/>with the code"]
        N3["Models run on<br/>one laptop"]
    end

    subgraph PROD["What a live system would have"]
        P1["S3 raises an event<br/>automatically, the moment<br/>a file lands"]
        P2["A purpose-built database<br/>updated one document at a<br/>time, never rebuilt"]
        P3["Models on a shared server<br/>so many people can ask<br/>at the same time"]
        P4["Login decides what you<br/>can see — not a dropdown"]
    end

    N1 -.->|"becomes"| P1
    N2 -.->|"becomes"| P2
    N3 -.->|"becomes"| P3

    style NOW fill:#f6f4ee,stroke:#c9a227
    style PROD fill:#eef4fb,stroke:#4a7fd9
```

**What stays exactly the same:** how files are sorted by type, how they're cut
up and labelled, how access is enforced, how searches are combined and ranked,
and how answers are checked against their sources.

That's deliberate. The expensive thing to get right is the *judgement* — what to
retrieve, how to rank it, when to refuse. Swapping files for a database is a
week's work against a settled design.

**The honest summary: the thinking is production-shaped. The plumbing isn't.**

### Concretely, the pieces they'd need

| Piece | What it does | Why |
|---|---|---|
| **S3** | Holds the original files | Already have it |
| **Event + queue** | Notices new files, queues the work | So nobody has to remember to press a button |
| **Workers** | Do the converting and labelling | Can run many at once when a batch arrives |
| **Vector database** | Holds the searchable passages | Updated one document at a time instead of rebuilt |
| **Model server** | Runs the AI models | One laptop can serve one person; a server serves everyone |
| **Login (SSO)** | Decides who sees what | Today it's a dropdown. That's fine for a demo and unacceptable in production — anyone can pick "Admin" |
| **Records database** | Which files exist, processing status, usage logs | Already built |

---

## Part 3 — When someone asks a question

Following one real question all the way through.

```mermaid
flowchart TB
    Q["<b>“What does Allistair McCaw<br/>say makes a great coach?”</b>"]

    subgraph UNDERSTAND["① Understand the question first"]
        U1["What kind of question is this?<br/><i>a fact from a document —<br/>not a sum over a spreadsheet</i>"]
    end

    Q --> U1

    subgraph SEARCH["② Two different searches, at the same time"]
        direction LR
        KW["<b>Exact-word search</b><br/>finds 'McCaw' literally.<br/>Good at names, codes,<br/>rare technical terms."]
        MEAN["<b>Meaning search</b><br/>finds 'great coach' ideas<br/>even when the words differ.<br/>Good at paraphrases."]
    end

    U1 --> KW & MEAN

    GATE{{"<b>Permission filter</b><br/>applied INSIDE both searches,<br/>before anything is ranked"}}

    KW --> GATE
    MEAN --> GATE

    subgraph RANK["③ Combine and rank"]
        FUSE["<b>Agreement wins.</b><br/>A passage both searches<br/>ranked highly is more<br/>trustworthy than one<br/>only either found."]
        RE["<b>Read the question against<br/>each passage</b> and re-order.<br/>Catches passages that share<br/>a word by coincidence."]
        FUSE --> RE
    end

    GATE --> FUSE

    CHECK{"<b>Is this evidence<br/>actually any good?</b>"}
    RE --> CHECK

    CHECK -->|"nothing relevant"| RETRY["Ask the question again,<br/>worded differently"]
    RETRY -->|"still nothing"| REFUSE["<b>“The knowledge base does not<br/>contain an answer to this.”</b><br/><i>No guessing.</i>"]
    RETRY -->|"better now"| PREP

    CHECK -->|"good"| PREP["④ Tidy up what the model sees<br/>remove duplicates, trim to the<br/>relevant sentences, put the<br/>strongest first and last"]

    PREP --> GEN["⑤ The AI writes the answer<br/>using <b>only</b> those passages"]
    GEN --> VERIFY["⑥ Check the answer<br/>every claim points at a real passage,<br/>every number appears in a source"]
    VERIFY --> OUT["<b>Answer + clickable sources</b>"]

    style UNDERSTAND fill:#eef4fb,stroke:#4a7fd9
    style SEARCH fill:#f6f4ee,stroke:#c9a227
    style RANK fill:#eef7ef,stroke:#4a8a52
    style GATE fill:#fff,stroke:#c9a227,stroke-width:3px
    style CHECK fill:#fff,stroke:#c9a227,stroke-width:2px
    style REFUSE fill:#fbeeee,stroke:#c0504d,stroke-width:2px
    style OUT fill:#eef7ef,stroke:#4a8a52,stroke-width:3px
```

---

## Part 4 — The same question, with the real sources it finds

This is a genuine result from the indexed material.

> **Question:** *"What does Allistair McCaw say makes a great coach?"*

**What the exact-word search finds** — it latches onto the name "McCaw":

| | |
|---|---|
| McCaw's recorded talk, spoken words, **0:02–1:27** | *"…my presentation on the four key areas I believe every coach…"* |
| McCaw's talk, **a slide on screen at 1:30** | *"A great coach isn't determined by the level of player they coach. A great coach is determined by…"* |

**What the meaning search finds** — it doesn't need the name at all, it matches
the *idea* of coaching quality:

| | |
|---|---|
| A coaching-conference recording by a different speaker | on coaching delivery and communication |
| A research PDF | on coach emotional intelligence |

**How they're combined:** the two passages from McCaw's own talk were found by
**both** searches, so they rise to the top. Two different methods, working in
completely different ways, independently agreeing — that's a much stronger
signal than either score on its own.

**What gets checked before answering:** does the evidence actually mention
"McCaw"? Yes. If a question named a person or a year the archive had never
heard of, it would stop here and say so rather than writing something
plausible.

**What the answer looks like:** a short paragraph, with `[1]` `[2]` markers, and
buttons underneath. Clicking one opens the recording **at 1:30** — the exact
moment that slide was on screen — beside the conversation, without losing your
place.

---

## Part 5 — Video, because it's the unusual part

Most search tools ignore video entirely. This one reads it two ways.

```mermaid
flowchart LR
    V[("A recorded<br/>conference talk")]

    V --> AUDIO["<b>What was said</b><br/>the speech is transcribed<br/>and timestamped"]
    V --> SCREEN["<b>What was shown</b><br/>a picture is taken every<br/>45 seconds and described"]

    AUDIO --> M[("Both go into the<br/>knowledge base<br/>with their timestamps")]
    SCREEN --> M

    M --> R["A question can now match<br/><b>either</b> — and the citation<br/>opens the video at that second"]

    style V fill:#eef4fb,stroke:#4a7fd9
    style M fill:#eef7ef,stroke:#4a8a52,stroke-width:2px
```

**Why both.** A speaker says *"as you can see here"* and everything that matters
is in the picture. Transcribing only the audio would lose it.

From the 23 recordings:

| | |
|---|---|
| Passages from speech | 438 |
| Passages from what was on screen | **626** |
| Total | 1,064 |

The on-screen pass found *more* than the speech did.

---

## The three things worth remembering

**1. Every answer is traceable.** Not "somewhere in the research" — a document,
a page, a slide, or a second of video, that opens in one click. An answer that
can't be checked isn't worth much.

**2. It refuses.** If the archive doesn't contain the answer, it says so instead
of writing something that sounds right. That is the hardest part to build and
the easiest to skip, and it's what separates a tool a coach can trust from one
they can't.

**3. It respects who you are.** A performance analyst and a physiotherapist ask
the same question and get different results, because the permission filter runs
*inside* the search rather than tidying up afterwards. Athlete medical data
never enters a search that shouldn't see it.
