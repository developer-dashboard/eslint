/**
 * @fileoverview Rule to enforce concise object methods and properties.
 * @author Jamund Ferguson
 */

"use strict";

const OPTIONS = {
    always: "always",
    never: "never",
    methods: "methods",
    properties: "properties",
    consistent: "consistent",
    consistentAsNeeded: "consistent-as-needed"
};

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------
const astUtils = require("../ast-utils");

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------
module.exports = {
    meta: {
        docs: {
            description: "require or disallow method and property shorthand syntax for object literals",
            category: "ECMAScript 6",
            recommended: false
        },

        fixable: "code",

        schema: {
            anyOf: [
                {
                    type: "array",
                    items: [
                        {
                            enum: ["always", "methods", "properties", "never", "consistent", "consistent-as-needed"]
                        }
                    ],
                    minItems: 0,
                    maxItems: 1
                },
                {
                    type: "array",
                    items: [
                        {
                            enum: ["always", "methods", "properties"]
                        },
                        {
                            type: "object",
                            properties: {
                                avoidQuotes: {
                                    type: "boolean"
                                }
                            },
                            additionalProperties: false
                        }
                    ],
                    minItems: 0,
                    maxItems: 2
                },
                {
                    type: "array",
                    items: [
                        {
                            enum: ["always", "methods"]
                        },
                        {
                            type: "object",
                            properties: {
                                ignoreConstructors: {
                                    type: "boolean"
                                },
                                avoidQuotes: {
                                    type: "boolean"
                                }
                            },
                            additionalProperties: false
                        }
                    ],
                    minItems: 0,
                    maxItems: 2
                }
            ]
        }
    },

    create(context) {
        const APPLY = context.options[0] || OPTIONS.always;
        const APPLY_TO_METHODS = APPLY === OPTIONS.methods || APPLY === OPTIONS.always;
        const APPLY_TO_PROPS = APPLY === OPTIONS.properties || APPLY === OPTIONS.always;
        const APPLY_NEVER = APPLY === OPTIONS.never;
        const APPLY_CONSISTENT = APPLY === OPTIONS.consistent;
        const APPLY_CONSISTENT_AS_NEEDED = APPLY === OPTIONS.consistentAsNeeded;

        const PARAMS = context.options[1] || {};
        const IGNORE_CONSTRUCTORS = PARAMS.ignoreConstructors;
        const AVOID_QUOTES = PARAMS.avoidQuotes;
        const sourceCode = context.getSourceCode();

        //--------------------------------------------------------------------------
        // Helpers
        //--------------------------------------------------------------------------

        /**
         * Determines if the first character of the name is a capital letter.
         * @param {string} name The name of the node to evaluate.
         * @returns {boolean} True if the first character of the property name is a capital letter, false if not.
         * @private
         */
        function isConstructor(name) {
            const firstChar = name.charAt(0);

            return firstChar === firstChar.toUpperCase();
        }

        /**
         * Determines if the property can have a shorthand form.
         * @param {ASTNode} property Property AST node
         * @returns {boolean} True if the property can have a shorthand form
         * @private
         **/
        function canHaveShorthand(property) {
            return (property.kind !== "set" && property.kind !== "get" && property.type !== "SpreadProperty" && property.type !== "ExperimentalSpreadProperty");
        }

        /**
          * Checks whether a node is a string literal.
          * @param   {ASTNode} node - Any AST node.
          * @returns {boolean} `true` if it is a string literal.
          */
        function isStringLiteral(node) {
            return node.type === "Literal" && typeof node.value === "string";
        }

        /**
         * Determines if the property is a shorthand or not.
         * @param {ASTNode} property Property AST node
         * @returns {boolean} True if the property is considered shorthand, false if not.
         * @private
         **/
        function isShorthand(property) {

            // property.method is true when `{a(){}}`.
            return (property.shorthand || property.method);
        }

        /**
         * Determines if the property's key and method or value are named equally.
         * @param {ASTNode} property Property AST node
         * @returns {boolean} True if the key and value are named equally, false if not.
         * @private
         **/
        function isRedundant(property) {
            const value = property.value;

            if (value.type === "FunctionExpression") {
                return !value.id; // Only anonymous should be shorthand method.
            }
            if (value.type === "Identifier") {
                return astUtils.getStaticPropertyName(property) === value.name;
            }

            return false;
        }

        /**
         * Ensures that an object's properties are consistently shorthand, or not shorthand at all.
         * @param   {ASTNode} node Property AST node
         * @param   {boolean} checkRedundancy Whether to check longform redundancy
         * @returns {void}
         **/
        function checkConsistency(node, checkRedundancy) {

            // We are excluding getters/setters and spread properties as they are considered neither longform nor shorthand.
            const properties = node.properties.filter(canHaveShorthand);

            // Do we still have properties left after filtering the getters and setters?
            if (properties.length > 0) {
                const shorthandProperties = properties.filter(isShorthand);

                // If we do not have an equal number of longform properties as
                // shorthand properties, we are using the annotations inconsistently
                if (shorthandProperties.length !== properties.length) {

                    // We have at least 1 shorthand property
                    if (shorthandProperties.length > 0) {
                        context.report({ node, message: "Unexpected mix of shorthand and non-shorthand properties." });
                    } else if (checkRedundancy) {

                        // If all properties of the object contain a method or value with a name matching it's key,
                        // all the keys are redundant.
                        const canAlwaysUseShorthand = properties.every(isRedundant);

                        if (canAlwaysUseShorthand) {
                            context.report({ node, message: "Expected shorthand for all properties." });
                        }
                    }
                }
            }
        }

        /**
        * Fixes a FunctionExpression node by making it into a shorthand property.
        * @param {SourceCodeFixer} fixer The fixer object
        * @param {ASTNode} node A `Property` node that has a `FunctionExpression` as its value
        * @returns {Object} A fix for this node
        */
        function makeFunctionShorthand(fixer, node) {
            const functionToken = sourceCode.getTokens(node.value).find(token => token.type === "Keyword" && token.value === "function");
            const tokenBeforeParams = node.value.generator ? sourceCode.getTokenAfter(functionToken) : functionToken;
            const firstKeyToken = node.computed ? sourceCode.getTokens(node).find(token => token.value === "[") : sourceCode.getFirstToken(node.key);
            const lastKeyToken = node.computed ? sourceCode.getTokensBetween(node.key, node.value).find(token => token.value === "]") : sourceCode.getLastToken(node.key);
            const keyText = sourceCode.text.slice(firstKeyToken.range[0], lastKeyToken.range[1]);
            let keyPrefix = "";

            if (node.value.generator) {
                keyPrefix = "*";
            } else if (node.value.async) {
                keyPrefix = "async ";
            }

            return fixer.replaceTextRange([firstKeyToken.range[0], tokenBeforeParams.range[1]], keyPrefix + keyText);
        }

        /**
        * Fixes a FunctionExpression node by making it into a longform property.
        * @param {SourceCodeFixer} fixer The fixer object
        * @param {ASTNode} node A `Property` node that has a `FunctionExpression` as its value
        * @returns {Object} A fix for this node
        */
        function makeFunctionLongform(fixer, node) {
            const firstKeyToken = node.computed ? sourceCode.getTokens(node).find(token => token.value === "[") : sourceCode.getFirstToken(node.key);
            const lastKeyToken = node.computed ? sourceCode.getTokensBetween(node.key, node.value).find(token => token.value === "]") : sourceCode.getLastToken(node.key);
            const keyText = sourceCode.text.slice(firstKeyToken.range[0], lastKeyToken.range[1]);
            let functionHeader = "function";

            if (node.value.generator) {
                functionHeader = "function*";
            } else if (node.value.async) {
                functionHeader = "async function";
            }

            return fixer.replaceTextRange([node.range[0], lastKeyToken.range[1]], `${keyText}: ${functionHeader}`);
        }

        //--------------------------------------------------------------------------
        // Public
        //--------------------------------------------------------------------------

        return {
            ObjectExpression(node) {
                if (APPLY_CONSISTENT) {
                    checkConsistency(node, false);
                } else if (APPLY_CONSISTENT_AS_NEEDED) {
                    checkConsistency(node, true);
                }
            },

            Property(node) {
                const isConciseProperty = node.method || node.shorthand;

                // Ignore destructuring assignment
                if (node.parent.type === "ObjectPattern") {
                    return;
                }

                // getters and setters are ignored
                if (node.kind === "get" || node.kind === "set") {
                    return;
                }

                // only computed methods can fail the following checks
                if (node.computed && node.value.type !== "FunctionExpression") {
                    return;
                }

                //--------------------------------------------------------------
                // Checks for property/method shorthand.
                if (isConciseProperty) {
                    if (node.method && (APPLY_NEVER || AVOID_QUOTES && isStringLiteral(node.key))) {

                        // { x() {} } should be written as { x: function() {} }
                        context.report({
                            node,
                            message: `Expected longform method syntax${APPLY_NEVER ? "" : " for string literal keys"}.`,
                            fix: fixer => makeFunctionLongform(fixer, node)
                        });
                    } else if (APPLY_NEVER) {

                        // { x } should be written as { x: x }
                        context.report({
                            node,
                            message: "Expected longform property syntax.",
                            fix: fixer => fixer.insertTextAfter(node.key, `: ${node.key.name}`)
                        });
                    }
                } else if (node.value.type === "FunctionExpression" && !node.value.id && APPLY_TO_METHODS) {
                    if (IGNORE_CONSTRUCTORS && isConstructor(node.key.name)) {
                        return;
                    }
                    if (AVOID_QUOTES && isStringLiteral(node.key)) {
                        return;
                    }

                    context.report({
                        node,
                        message: "Expected method shorthand.",
                        fix: fixer => makeFunctionShorthand(fixer, node)
                    });
                } else if (node.value.type === "Identifier" && node.key.name === node.value.name && APPLY_TO_PROPS) {

                    // {x: x} should be written as {x}
                    context.report({
                        node,
                        message: "Expected property shorthand.",
                        fix(fixer) {
                            return fixer.replaceText(node, node.value.name);
                        }
                    });
                } else if (node.value.type === "Identifier" && node.key.type === "Literal" && node.key.value === node.value.name && APPLY_TO_PROPS) {
                    if (AVOID_QUOTES) {
                        return;
                    }

                    // {"x": x} should be written as {x}
                    context.report({
                        node,
                        message: "Expected property shorthand.",
                        fix(fixer) {
                            return fixer.replaceText(node, node.value.name);
                        }
                    });
                }
            }
        };
    }
};
