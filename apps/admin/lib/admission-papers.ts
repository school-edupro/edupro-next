/** Test and interview papers by class (docs/design/57, part 1). */
export interface PaperPart {
  id: string;
  /** the entry of the school's list (Subjects and parameters) */
  itemId: string | null;
  name: string;
  maxMarks: number;
  passMarks: number | null;
}
export interface Paper {
  id: string;
  minPercent: number | null;
  parts: PaperPart[];
  /** the class's maximum for the stage: the sum of the parts */
  total: number;
}
export interface PapersView {
  stage: { id: string; name: string; kind: 'test' | 'interview'; maxMarks: number | null };
  stages: Array<{ id: string; name: string; kind: string }>;
  classes: Array<{ id: string; name: string; paper: Paper | null }>;
  /** the list's entries a part may be (an entry switched off but still on a paper: off) */
  items: Array<{ id: string; name: string; maxMarks: number | null; off: boolean }>;
}
/** An entry of the school's test subjects and interview parameters. */
export interface PaperItem {
  id: string;
  name: string;
  kind: 'test' | 'interview' | 'both';
  maxMarks: number | null;
  status: 'active' | 'inactive';
  /** the papers using it */
  used: number;
  usedIn: Array<'test' | 'interview'>;
}
export interface PaperItemsView {
  items: PaperItem[];
  /** the school's scholastic subjects not on the list yet */
  subjects: string[];
}
