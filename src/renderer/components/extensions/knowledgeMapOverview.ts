import type { ExtensionStoryBlock } from './ExtensionStoryBlocks';

/** Built-in sample; claims reflect the shipped llmdoc README and manifest. */
export const knowledgeMapOverview = [
  {
    type: 'hero',
    eyebrow: 'Project knowledge',
    title: 'Know what to review after a code change',
    description:
      'Start from a changed source file, find the docs that describe it, and see what needs review before asking the agent to update anything.',
    highlights: [
      'Look up docs by source path',
      'Read-only impact checks',
      'Approve maintenance before changes',
    ],
  },
  {
    type: 'showcase',
    title: 'Trace a change from code to docs',
    file: 'src/auth/session.ts',
    items: [
      { title: 'llmdoc/architecture/auth.mdx', description: 'Affected' },
      { title: 'llmdoc/guides/sign-in.mdx', description: 'Document needs review' },
    ],
    prompt: 'Which docs need review after I changed sign-in?',
    reply:
      'The change touches the session flow. I found the authentication overview and the sign-in guide. I’ll check both against the source and suggest edits before changing any files.',
  },
  {
    type: 'comparison',
    title: 'From searching the repository to a review list',
    before: 'Manual lookup',
    after: 'With Knowledge Map',
    pairs: [
      {
        before: 'Search for a title or keyword and open likely matches.',
        after: 'Look up the docs related to the exact changed source path.',
      },
      {
        before: 'Check each result against the Git diff yourself.',
        after: 'Separate affected docs, docs to review, and unmapped source files.',
      },
    ],
  },
  {
    type: 'steps',
    title: 'How to use',
    items: [
      {
        title: 'Open Knowledge Map',
        description:
          'In a local Code session for a Git project, open Knowledge Map from the right sidebar’s + menu. It detects Node.js 22.13+, Git, and a compatible llmdoc CLI. If only the CLI is missing, choose Install llmdoc.',
      },
      {
        title: 'Find related knowledge',
        description:
          'If the project has no llmdoc/ directory, choose Initialize to prepare an agent request. If it already has docs, browse or search them, or look up a path such as src/auth/session.ts.',
      },
      {
        title: 'Review the impact of changes',
        description:
          'After a code change, check the impact report. Use Review & update to prepare a maintenance request, then review the agent’s proposed changes before approving them.',
      },
    ],
  },
] satisfies readonly ExtensionStoryBlock[];
