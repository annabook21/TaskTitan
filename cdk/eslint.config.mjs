import appsyncPlugin from "@aws-appsync/eslint-plugin";

export default [
  {
    files: ["lib/constructs/appsync-graphql/resolvers/**/*.js"],
    plugins: {
      "@aws-appsync": appsyncPlugin,
    },
    rules: {
      "@aws-appsync/no-async": "error",
      "@aws-appsync/no-await": "error",
      "@aws-appsync/no-classes": "error",
      "@aws-appsync/no-continue": "error",
      "@aws-appsync/no-generators": "error",
      "@aws-appsync/no-labels": "error",
      "@aws-appsync/no-regex": "error",
      "@aws-appsync/no-this": "error",
      "@aws-appsync/no-try": "error",
      "@aws-appsync/no-while": "error",
      "@aws-appsync/no-yield": "error",
      "@aws-appsync/no-disallowed-unary-operators": "error",
      "@aws-appsync/no-disallowed-binary-operators": "error",
      "@aws-appsync/no-promise": "error",
      "@aws-appsync/no-in-operator": "error",
    },
  },
];
