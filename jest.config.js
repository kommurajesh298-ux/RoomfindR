module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/tests/helpers/**/*.test.ts'],
    moduleNameMapper: {
        '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    },
};
