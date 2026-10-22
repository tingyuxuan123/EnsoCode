export interface CodeSearchRange {
  start: number;
  end: number;
  content: string;
}

export interface CodeSearchFile {
  path: string;
  ranges: CodeSearchRange[];
}

export interface CodeSearchResult {
  status: 'success' | 'partial' | 'no_matches' | 'error';
  files: CodeSearchFile[];
  content: string;
  truncated: boolean;
  warnings: string[];
  code?: string;
}
