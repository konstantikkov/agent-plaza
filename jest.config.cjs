/** Jest config: TypeScript via ts-jest, jsdom for the WebMCP/React tests. */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setup.ts'],
  moduleNameMapper: {
    '^@/shared/config$': '<rootDir>/tests/stubs/config.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          jsx: 'react-jsx',
          allowJs: true,
          esModuleInterop: true,
          strict: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
  // use-webmcp-tool ships untranspiled ESM
  transformIgnorePatterns: ['node_modules/(?!use-webmcp-tool)'],
};
