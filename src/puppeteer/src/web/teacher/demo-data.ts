export type Student = {
  id: string;
  name: string;
  sessions: number;
  lastSession: string;
  engagement: "high" | "steady" | "low";
  focus: string;
};

export type Topic = { name: string; sessions: number };

export type Struggle = {
  id: string;
  title: string;
  students: number;
  detail: string;
  sockyMove: string;
};

export type SessionReport = {
  id: string;
  when: string;
  minutes: number;
  turns: number;
  student: string;
  topics: string[];
  struggles: string[];
  summary: string;
  live?: boolean;
};

export const classroomName = "Ms. Alvarez · Room 12 · Grade 5";

export const demoStats = {
  sessionsThisWeek: 47,
  studentsReached: 8,
  avgMinutes: 18,
  topicsCovered: 12,
};

export const demoStudents: Student[] = [
  {
    id: "maya",
    name: "Maya Chen",
    sessions: 9,
    lastSession: "Yesterday",
    engagement: "high",
    focus: "Equivalent fractions",
  },
  {
    id: "jonah",
    name: "Jonah Patel",
    sessions: 7,
    lastSession: "Today",
    engagement: "steady",
    focus: "Word problems",
  },
  {
    id: "avery",
    name: "Avery Brooks",
    sessions: 6,
    lastSession: "Mon",
    engagement: "low",
    focus: "Speaking when stuck",
  },
  {
    id: "luis",
    name: "Luis Ortega",
    sessions: 8,
    lastSession: "Yesterday",
    engagement: "high",
    focus: "Place value",
  },
  {
    id: "harper",
    name: "Harper Nguyen",
    sessions: 5,
    lastSession: "Tue",
    engagement: "steady",
    focus: "Story structure",
  },
  {
    id: "samira",
    name: "Samira Ali",
    sessions: 6,
    lastSession: "Today",
    engagement: "high",
    focus: "Photosynthesis",
  },
  {
    id: "theo",
    name: "Theo Walsh",
    sessions: 4,
    lastSession: "Wed",
    engagement: "steady",
    focus: "Reading graphs",
  },
  {
    id: "quinn",
    name: "Quinn Park",
    sessions: 2,
    lastSession: "Mon",
    engagement: "low",
    focus: "Staying on the prompt",
  },
];

export const demoTopics: Topic[] = [
  { name: "Fractions", sessions: 14 },
  { name: "Photosynthesis", sessions: 8 },
  { name: "Story structure", sessions: 7 },
  { name: "Place value", sessions: 6 },
  { name: "Feelings & friendship", sessions: 5 },
  { name: "Measurement", sessions: 4 },
];

export const demoStruggles: Struggle[] = [
  {
    id: "word-problems",
    title: "Multi-step word problems",
    students: 5,
    detail:
      "Students jump to the first number they hear instead of naming the question.",
    sockyMove: "Ask them to retell the story in their own words before any math.",
  },
  {
    id: "stuck",
    title: "Speaking up when stuck",
    students: 6,
    detail: "Long silences. A few students wait for Socky to fill the gap.",
    sockyMove: "Count to five out loud, then offer two choices, not the answer.",
  },
  {
    id: "place-value",
    title: "Regrouping and place value",
    students: 4,
    detail: "Tens and ones get swapped when the problem is spoken, not written.",
    sockyMove: "Use a soccer-score analogy (Jonah) and draw tens as bundles.",
  },
  {
    id: "prompt",
    title: "Staying on the prompt",
    students: 3,
    detail: "Side stories about recess crowd out the lesson question.",
    sockyMove: "Warm nod, then a one-line recap of the question on the board.",
  },
];

export const demoNotes = `Ms. Alvarez, Room 12, grade 5.

This week: equivalent fractions and comparing fractions with unlike denominators.

Remember:
- Maya needs extra wait time. Do not rush her first try.
- Jonah lights up with soccer analogies.
- Avery is quiet; invite a thumbs-up before asking them to speak.
- Celebrate tries, not only correct answers.
- Do not assign homework. Do not ask for home addresses or last names.

Warm-up if the class is restless: 20-second freeze dance, then back to the board.`;

export const demoReports: SessionReport[] = [
  {
    id: "r-seed-1",
    when: "Thu 10:15",
    minutes: 16,
    turns: 22,
    student: "Small group · Maya, Jonah, Luis",
    topics: ["Fractions", "Word problems"],
    struggles: ["Multi-step word problems"],
    summary:
      "Socky walked three students through a pizza-sharing story. Maya named the question on the second try. Jonah needed the soccer-score analogy once, then compared 2/3 and 3/4 without a prompt.",
  },
  {
    id: "r-seed-2",
    when: "Wed 13:40",
    minutes: 21,
    turns: 31,
    student: "Whole class",
    topics: ["Photosynthesis", "Feelings & friendship"],
    struggles: ["Speaking up when stuck"],
    summary:
      "Science block. Samira explained sunlight as food for the plant. Avery gave a thumbs-up but did not speak. Socky offered two sentence starters; Avery picked one.",
  },
  {
    id: "r-seed-3",
    when: "Tue 9:05",
    minutes: 12,
    turns: 14,
    student: "Harper, Quinn",
    topics: ["Story structure"],
    struggles: ["Staying on the prompt"],
    summary:
      "Reading pair. Harper found the problem in the story. Quinn drifted to recess twice; Socky recapped the prompt and they finished a beginning-middle-end map.",
  },
];

export const topicLexicon: { name: string; keys: string[] }[] = [
  { name: "Fractions", keys: ["fraction", "numerator", "denominator", "half", "third", "quarter"] },
  { name: "Photosynthesis", keys: ["photosynthesis", "chlorophyll", "sunlight", "plant"] },
  { name: "Story structure", keys: ["story", "character", "beginning", "middle", "end"] },
  { name: "Place value", keys: ["place value", "tens", "ones", "regroup"] },
  { name: "Feelings & friendship", keys: ["friend", "feeling", "kind", "share"] },
  { name: "Measurement", keys: ["inch", "centimeter", "measure", "ruler"] },
  { name: "Word problems", keys: ["word problem", "how many", "in all", "left over"] },
];

export const struggleLexicon: { title: string; keys: string[] }[] = [
  { title: "Multi-step word problems", keys: ["word problem", "two steps", "then"] },
  { title: "Speaking up when stuck", keys: ["i don't know", "stuck", "um"] },
  { title: "Regrouping and place value", keys: ["tens", "ones", "carry", "regroup"] },
  { title: "Staying on the prompt", keys: ["anyway", "recess", "wait but"] },
];
