import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tsParser from '@typescript-eslint/parser';
import tseslint from '@typescript-eslint/eslint-plugin';

export default [
  js.configs.recommended,

  // Global ignores
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.wrangler/**', '**/coverage/**'],
  },

  // Base config for all JS files
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        crypto: 'readonly',
        structuredClone: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        globalThis: 'readonly',
        WebSocket: 'readonly',
        EventSource: 'readonly',
        queueMicrotask: 'readonly',
        performance: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-const': 'warn',
    },
  },

  // TypeScript config
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'warn',
    },
  },

  // React config for CLI (Ink) and Web packages
  {
    files: [
      'packages/cli/**/*.jsx',
      'packages/cli/**/*.tsx',
      'packages/web/**/*.jsx',
      'packages/web/**/*.tsx',
      'packages/web/**/*.js',
      'packages/web/**/*.ts',
    ],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // Not needed with modern JSX transform
      'react/prop-types': 'off', // No PropTypes in this codebase
    },
  },

  // Web package: browser globals
  {
    files: [
      'packages/web/**/*.js',
      'packages/web/**/*.jsx',
      'packages/web/**/*.ts',
      'packages/web/**/*.tsx',
    ],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        Event: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
      },
    },
  },

  // MCP package: no console.log (breaks stdio protocol)
  {
    files: ['packages/mcp/**/*.js', 'packages/mcp/**/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },

  // Test files: allow common test globals + browser globals (jsdom environment)
  {
    files: ['**/*.test.js', '**/*.test.jsx', '**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
        // Browser globals available in jsdom test environment
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
        history: 'readonly',
        navigator: 'readonly',
        MouseEvent: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        HTMLInputElement: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        DOMException: 'readonly',
      },
    },
  },

  // Worker package: Cloudflare Workers globals
  {
    files: ['packages/worker/**/*.js', 'packages/worker/**/*.ts'],
    languageOptions: {
      globals: {
        DurableObject: 'readonly',
        WebSocketPair: 'readonly',
      },
    },
  },
];
