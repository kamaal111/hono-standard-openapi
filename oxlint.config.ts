import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc'],
  jsPlugins: [{ name: 'import-js', specifier: 'eslint-plugin-import' }],
  options: {
    typeAware: true,
  },
  categories: {
    correctness: 'error',
  },
  rules: {
    'typescript/no-deprecated': 'error',
    'typescript/consistent-type-imports': 'error',
    'typescript/no-non-null-assertion': 'error',
    'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    'import-js/order': [
      'error',
      {
        groups: ['builtin', 'external', ['internal', 'parent', 'sibling', 'index']],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
  },
  env: {
    builtin: true,
  },
  ignorePatterns: ['dist/**/*'],
});
