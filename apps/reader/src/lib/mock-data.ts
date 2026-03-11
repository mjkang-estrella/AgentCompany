export type ReaderSection = {
  id: string;
  label: string;
  count: number;
};

export type ReaderView = {
  id: string;
  icon: string;
  name: string;
  query: string;
};

export type ReaderHighlight = {
  id: string;
  paragraphId: string;
  text: string;
  color: "yellow" | "green" | "blue";
  note: string;
  createdAt: string;
};

export type ReaderParagraph = {
  id: string;
  text: string;
  skim: boolean;
};

export type ReaderDocument = {
  id: string;
  title: string;
  author: string;
  source: string;
  sourceType: "article" | "pdf" | "rss" | "epub" | "tweet";
  section: "inbox" | "later" | "shortlist" | "archive" | "feed" | "trash";
  length: string;
  readingTime: string;
  savedAt: string;
  progress: number;
  summary: string[];
  tags: string[];
  paragraphs: ReaderParagraph[];
  highlights: ReaderHighlight[];
};

export const sections: ReaderSection[] = [
  { id: "inbox", label: "Inbox", count: 18 },
  { id: "later", label: "Later", count: 42 },
  { id: "shortlist", label: "Shortlist", count: 11 },
  { id: "feed", label: "Feed", count: 97 },
  { id: "archive", label: "Archive", count: 230 },
  { id: "trash", label: "Trash", count: 3 },
];

export const savedViews: ReaderView[] = [
  { id: "continue-reading", icon: "C", name: "Continue reading", query: "progress > 0" },
  { id: "quick-reads", icon: "Q", name: "Quick reads", query: "reading time under 10m" },
  { id: "long-reads", icon: "L", name: "Long reads", query: "reading time over 20m" },
  { id: "recently-highlighted", icon: "R", name: "Recently highlighted", query: "has highlights" },
];

export const documents: ReaderDocument[] = [
  {
    id: "doc-1",
    title: "Why Reading Software Should Feel Like a Thinking Tool",
    author: "Mara Kline",
    source: "Everywhere Weekly",
    sourceType: "article",
    section: "later",
    length: "5,982 words",
    readingTime: "24 min",
    savedAt: "Today, 7:14 AM",
    progress: 38,
    tags: ["thinking", "product", "tools"],
    summary: [
      "Reading apps become sticky when they reduce capture friction without breaking the reader's flow.",
      "The author argues for one surface that unifies saved articles, newsletters, PDFs, and highlights.",
      "Annotation matters only when export and resurfacing feel automatic rather than ceremonial.",
    ],
    paragraphs: [
      {
        id: "p-1",
        skim: true,
        text: "Software for serious reading fails when it behaves like a filing cabinet. The reader does not want a perfect hierarchy. The reader wants momentum, context, and a way to turn passing insight into durable knowledge.",
      },
      {
        id: "p-2",
        skim: false,
        text: "That is why the best reading tools borrow from both RSS readers and note-taking software. They make ingestion nearly invisible, but they keep just enough structure around each document so that recall, search, and resurfacing become effortless later.",
      },
      {
        id: "p-3",
        skim: true,
        text: "A strong reader interface treats annotation as a native operation. Highlighting a passage should feel closer to underlining a paperback than to creating a database record, even if the system turns that gesture into structured data behind the scenes.",
      },
      {
        id: "p-4",
        skim: false,
        text: "The moment a saved item lands in your queue, the app should already know how to present it: article in clean text, PDF with original fallback, EPUB with comfortable typography, feed item with skim mode, transcript with time-linked context.",
      },
      {
        id: "p-5",
        skim: true,
        text: "The winning product pattern is not minimalism for its own sake. It is calm density: enough metadata, filtering, and keyboardable controls to support power users, but not so much chrome that reading becomes secondary to software.",
      },
      {
        id: "p-6",
        skim: false,
        text: "When AI enters the picture, the bar rises. Readers will forgive imperfect summaries, but they will not forgive losing the original source. The assistant must stay subordinate to the document, not the other way around.",
      },
      {
        id: "p-7",
        skim: true,
        text: "In other words, the reading app that lasts is not a content graveyard. It is a live workspace for deciding what matters now, what matters later, and what deserves to be remembered.",
      },
    ],
    highlights: [
      {
        id: "h-1",
        paragraphId: "p-1",
        text: "The reader wants momentum, context, and a way to turn passing insight into durable knowledge.",
        color: "yellow",
        note: "This feels like the core product thesis.",
        createdAt: "7:32 AM",
      },
      {
        id: "h-2",
        paragraphId: "p-6",
        text: "The assistant must stay subordinate to the document, not the other way around.",
        color: "green",
        note: "Use this framing for the AI affordance panel.",
        createdAt: "7:40 AM",
      },
    ],
  },
  {
    id: "doc-2",
    title: "A Portable Feed Strategy for Researchers",
    author: "Trent Howard",
    source: "Notebook Dispatch",
    sourceType: "rss",
    section: "feed",
    length: "3,126 words",
    readingTime: "11 min",
    savedAt: "Yesterday, 9:28 PM",
    progress: 6,
    tags: ["rss", "research"],
    summary: [
      "Research queues get easier to maintain when feed filtering happens before triage.",
      "The best feeds are opinionated and composable rather than exhaustive.",
      "Portable export keeps people from feeling trapped in a single app.",
    ],
    paragraphs: [
      {
        id: "p-8",
        skim: true,
        text: "Most people overload their feed with every possible source and then blame themselves when triage becomes a chore. The bottleneck is usually not discipline. It is source quality.",
      },
      {
        id: "p-9",
        skim: true,
        text: "A good feed view should answer one question quickly: which items deserve to graduate into long-term attention? Everything else is noise management.",
      },
      {
        id: "p-10",
        skim: false,
        text: "When you can save selectively from feeds into a deeper reading library, you get the best of both worlds. Feeds stay disposable. Library items become durable objects with notes, highlights, and export pipelines.",
      },
    ],
    highlights: [
      {
        id: "h-3",
        paragraphId: "p-10",
        text: "Feeds stay disposable. Library items become durable objects.",
        color: "blue",
        note: "",
        createdAt: "9:31 PM",
      },
    ],
  },
  {
    id: "doc-3",
    title: "Designing Better PDF Reading Modes",
    author: "Aya Morales",
    source: "Annotation Review",
    sourceType: "pdf",
    section: "inbox",
    length: "18 pages",
    readingTime: "32 min",
    savedAt: "Monday, 1:05 PM",
    progress: 0,
    tags: ["pdf", "ux", "annotation"],
    summary: [
      "Readers want a graceful fallback between extracted text and the original PDF.",
      "Margins and contrast matter more than decorative controls.",
      "Highlights should remain stable across view modes.",
    ],
    paragraphs: [
      {
        id: "p-11",
        skim: true,
        text: "PDF support is often where otherwise elegant reading products reveal their compromises. Extraction helps readability, but fidelity matters when pagination, diagrams, and references are part of the meaning.",
      },
      {
        id: "p-12",
        skim: false,
        text: "The interface should not force a philosophical choice between original and simplified. It should let the reader move between them with confidence that notes and highlights still belong to the same document.",
      },
      {
        id: "p-13",
        skim: true,
        text: "A good PDF mode is not flashy. It is respectful. It preserves context while keeping the reading surface quiet.",
      },
    ],
    highlights: [],
  },
  {
    id: "doc-4",
    title: "Rebuilding a Personal Canon from Highlights",
    author: "Nina Park",
    source: "Longform Letters",
    sourceType: "epub",
    section: "later",
    length: "7,440 words",
    readingTime: "31 min",
    savedAt: "Last week",
    progress: 100,
    tags: ["books", "highlights"],
    summary: [
      "Revisiting old highlights creates better retention than storing more unread links.",
      "Tagging needs to happen at the moment of recognition, not later in bulk.",
    ],
    paragraphs: [
      {
        id: "p-14",
        skim: true,
        text: "Many people treat highlights like proof that they engaged with a text. In practice, highlights are only useful once they can be searched, reviewed, and re-contextualized across everything else you have read.",
      },
      {
        id: "p-15",
        skim: false,
        text: "The challenge is that most reading software stores highlights as an afterthought. A better system treats them as first-class artifacts, complete with backlinks to the source, timestamps, tags, and personal commentary.",
      },
    ],
    highlights: [
      {
        id: "h-4",
        paragraphId: "p-15",
        text: "A better system treats them as first-class artifacts.",
        color: "yellow",
        note: "This should show up in the highlights queue.",
        createdAt: "Last week",
      },
    ],
  },
  {
    id: "doc-5",
    title: "The Great Online Game",
    author: "Packy McCormick",
    source: "Not Boring",
    sourceType: "article",
    section: "later",
    length: "4,320 words",
    readingTime: "17 min",
    savedAt: "May 10, 2021",
    progress: 12,
    tags: ["social", "twitter"],
    summary: [
      "Internet businesses increasingly behave like persistent multiplayer worlds.",
      "Distribution loops matter more when products are also social stages.",
      "The strongest products teach users how to play before they ask them to create.",
    ],
    paragraphs: [
      {
        id: "p-16",
        skim: true,
        text: "The internet is increasingly less like a library and more like a sprawling online game with status systems, guilds, maps, and rituals that shape how people spend attention.",
      },
      {
        id: "p-17",
        skim: false,
        text: "This does not only matter for entertainment products. Software products become more durable when they understand how identity, social proof, and progression loops interact with utility.",
      },
      {
        id: "p-18",
        skim: true,
        text: "Every good online system quietly teaches users the moves that matter. The product feels obvious only because the scaffolding is hidden.",
      },
    ],
    highlights: [
      {
        id: "h-5",
        paragraphId: "p-17",
        text: "Software products become more durable when they understand how identity, social proof, and progression loops interact with utility.",
        color: "yellow",
        note: "",
        createdAt: "8:14 AM",
      },
    ],
  },
  {
    id: "doc-6",
    title: "How to Be Great? Just Be Good, Repeatedly",
    author: "Steph Smith",
    source: "Steph Smith",
    sourceType: "article",
    section: "later",
    length: "2,980 words",
    readingTime: "13 min",
    savedAt: "Jun 12, 2019",
    progress: 54,
    tags: ["productivity", "system"],
    summary: [
      "Greatness often emerges from repeated competence rather than isolated brilliance.",
      "Systems help people sustain quality when motivation fluctuates.",
      "Compounding effort is easier to believe in once the feedback loop is visible.",
    ],
    paragraphs: [
      {
        id: "p-19",
        skim: true,
        text: "People romanticize spikes of brilliance, but most durable outcomes come from a quieter rhythm: good decisions, repeated over and over, until they look exceptional from the outside.",
      },
      {
        id: "p-20",
        skim: false,
        text: "A system does not guarantee greatness. It creates conditions under which progress becomes likelier than drift.",
      },
      {
        id: "p-21",
        skim: true,
        text: "The real win is not intensity. It is making the next good action easier to take than the lazy one.",
      },
    ],
    highlights: [],
  },
];

export const chatPrompts = [
  "Summarize the argument in three bullets",
  "Pull out the most reusable insight",
  "List concepts worth tagging",
  "Compare this with similar saved pieces",
];
