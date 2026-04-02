import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

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

  // React config for CLI (Ink) and Web packages
  {
    files: ['packages/cli/**/*.jsx', 'packages/web/**/*.jsx', 'packages/web/**/*.js'],
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

  // MCP package: no console.log (breaks stdio protocol)
  {
    files: ['packages/mcp/**/*.js'],
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },

  // Test files: allow common test globals
  {
    files: ['**/*.test.js', '**/*.test.jsx', '**/__tests__/**'],
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
      },
    },
  },

  // Worker package: Cloudflare Workers globals
  {
    files: ['packages/worker/**/*.js'],
    languageOptions: {
      globals: {
        DurableObject: 'readonly',
      },
    },
  },
];
