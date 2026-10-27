/** Test and interview papers by class (docs/design/57, part 1). */
export interface PaperPart {
  id: string;
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
  /** names offered while typing a part */
  picks: string[];
}
