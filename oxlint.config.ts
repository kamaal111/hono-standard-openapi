import kamaalQualityConfig from '@kamaal111/kamaal-quality-config';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [kamaalQualityConfig],
  plugins: ['typescript', 'unicorn', 'oxc'],
  options: {
    typeAware: true,
  },
  categories: {
    correctness: 'error',
  },
  rules: {
    curly: 'error',
    'typescript/no-deprecated': 'error',
    'typescript/consistent-type-imports': 'error',
    'typescript/no-non-null-assertion': 'error',
    'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    'oxc/no-accumulating-spread': 'error',
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
  ignorePatterns: ['.agents/**', '.codex/**', 'dist/**/*'],
});
