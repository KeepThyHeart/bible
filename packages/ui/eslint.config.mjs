// S8 guard for packages/ui (0062). Keeps the package portable across React 18 and
// preact/compat, free of app coupling, and safe to run inside sandboxed panel iframes.
// Runs via the `pretest` hook, so `npm test` (and CI) enforces it.
import tseslint from 'typescript-eslint';

const REACT_BANNED = [
  'use', 'useTransition', 'useDeferredValue', 'startTransition', 'useInsertionEffect',
  'useActionState', 'useOptimistic', 'useEffectEvent', 'cache', 'Activity',
];
const REACT_DOM_BANNED = ['flushSync', 'useFormStatus', 'preload', 'preinit', 'preconnect', 'prefetchDNS',
  'render', 'hydrate', 'findDOMNode', 'unmountComponentAtNode'];
const why = 'packages/ui targets the React 18 subset that preact/compat implements faithfully (0062 rules).';

export default [
  { ignores: ['node_modules/**', 'dist-kit/**', 'css/**', 'lint-fixtures/**'] },
  tseslint.configs.base,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', importNames: REACT_BANNED, message: why },
          { name: 'react-dom', importNames: REACT_DOM_BANNED, message: why },
          { name: 'react-dom/server', message: 'No SSR APIs in packages/ui.' },
          { name: 'react-i18next', message: 'No i18n library in packages/ui: take labels as props (English defaults).' },
          { name: 'i18next', message: 'No i18n library in packages/ui: take labels as props.' },
          { name: 'zustand', message: 'No stores in packages/ui: take data via props or ReadableStore/useReadable.' },
          { name: '@bible/core', message: 'Import @bible/core/browser; the barrel pulls in Node and better-sqlite3.' },
          { name: 'electron', message: 'packages/ui runs in browsers and sandboxed iframes.' },
        ],
        patterns: [
          { group: ['zustand/*'], message: 'No stores in packages/ui.' },
          { group: ['@bible/core/*', '!@bible/core/browser'], message: 'Only @bible/core/browser is allowed.' },
          { group: ['preact', 'preact/*'], message: 'Write against the react API; preact is supplied by aliasing.' },
          { group: ['**/apps/**', '@bible/web', '@bible/web/*', '@bible/desktop', '@bible/desktop/*', '@/*'],
            message: 'packages/ui must not import app code.' },
          { group: ['**/stores/**', '**/store/**'], message: 'No app stores in packages/ui.' },
        ],
      }],
      'no-restricted-syntax': ['error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'No dangerouslySetInnerHTML: the kit renders host/extension strings (XSS).' },
        { selector: "AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(innerHTML|outerHTML)$/]",
          message: 'No innerHTML/outerHTML assignment (XSS).' },
        { selector: "CallExpression[callee.property.name=/^(insertAdjacentHTML|write|writeln)$/]",
          message: 'No HTML string injection (XSS).' },
        { selector: "CallExpression[callee.name='eval'], NewExpression[callee.name='Function'], CallExpression[callee.name='Function']",
          message: 'No eval/new Function: the panel CSP has no unsafe-eval, and it must stay that way.' },
        { selector: `MemberExpression[object.name=/^(React|ReactDOM)$/][property.name=/^(${[...REACT_BANNED, ...REACT_DOM_BANNED].join('|')})$/]`,
          message: why },
        { selector: "JSXAttribute[name.name=/^(className|class)$/] > Literal[value=/(^|\\s)(?!kth-)\\S/]",
          message: 'packages/ui uses only kth-* classes (no Tailwind or app BEM classes).' },
      ],
      'no-restricted-globals': ['error',
        { name: 'localStorage', message: 'Throws in sandboxed panels (opaque origin); take persistence via props.' },
        { name: 'sessionStorage', message: 'Throws in sandboxed panels (opaque origin).' },
        { name: 'fetch', message: 'Kit components reach the host only through the RPC client passed to KthKit.init.' },
      ],
    },
  },
];
