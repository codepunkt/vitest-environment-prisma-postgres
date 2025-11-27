import type { Config } from 'release-it';

export default {
  git: {
    requireCleanWorkingDir: false,
    commit: true,
    tag: true,
    push: true,
  },
  github: {
    release: true,
  },
  npm: {
    publish: true,
  },
  plugins: {
    '@release-it/conventional-changelog': {
      infile: 'CHANGELOG.md',
      header: '# Changelog',
      preset: {
        name: 'conventionalcommits',
        types: [
          { type: 'feat', section: '✨ New Features' },
          { type: 'perf', section: '🚀 Performance' },
          { type: 'fix', section: '🐛 Bug Fixes' },
          { type: 'ci', section: '⚙️ CI' },
          { type: 'build', hidden: true },
          { type: 'docs', section: '📚 Documentation' },
          { type: 'chore', hidden: true },
          { type: 'refactor', hidden: true },
          { type: 'test', hidden: true },
        ],
      },
    },
  },
} satisfies Config;
