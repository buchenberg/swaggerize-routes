'use strict';
const debug = require('debug')('routes');
var utils = require('./utils'),
    validation = require('./validator'),
    readhandlers = require('./readhandlers'),
    thing = require('core-util-is'),
    path = require('path'),
    assert = require('assert');

/**
 * Convert definition of api to something we can work with.
 * @param options
 * @returns {Array}
 */
function buildroutes(options) {
    var api, routes, handlers, defaulthandler, validator;

    api = options.api;
    handlers = readhandlers(options.handlers);
    defaulthandler = options.defaulthandler;
    validator = validation(options);
    routes = [];

    Object.keys(api.paths).forEach(function (path) {
        var def = options.api.paths[path];

        utils.verbs.forEach(function (verb) {
            var route, pathnames, operation, validators;

            operation = def[verb];

            if (!operation) {
                return;
            }

            route = {
                path: path,
                name: operation.operationId,
                description: operation.description,
                method: verb,
                security: buildSecurity(options, api.securityDefinitions, operation.security || def.security || api.security),
                validators: [],
                // handler : defaulthandler || undefined,
                consumes: operation.consumes || api.consumes,
                produces: operation.produces || api.produces,
                json: operation.json || api.json,
                cache: operation.cache || api.cache,
                config: operation.config || api.config,
                jsonp: operation.jsonp || api.jsonp
            };

            validators = {};

            if (def.parameters) {
                def.parameters.forEach(function (parameter) {
                    validators[parameter.in + parameter.name] = parameter;
                });
            }

            if (operation.parameters) {
                operation.parameters.forEach(function (parameter) {
                    validators[parameter.in + parameter.name] = parameter;
                });
            }

            route.validators = validator.makeAll(validators, route);

            pathnames = [];

            //Figure out the names from the params.
            path.split('/').forEach(function (element) {
                if (element) {
                    pathnames.push(element);
                }
            });


            // TODO: Handle missing file here. Fallback to default.
            switch (operation.hasOwnProperty('x-handler')) {
                case true:
                    if (path.existsSync(operation['x-handler'])) {
                        debug(`Using ${operation['x-handler']} for ${path} ${verb}`);
                        route.handler = operation['x-handler'];
                        route.handler = route.handler && resolve(options.basedir, route.handler, verb);
                    } else {
                        debug(`Route building failed for ${verb} at ${path}. The specified x-handler ${operation['x-handler']} doesn't exist. FAKE NEWS!`);
                        debug(`Using default handler.`);
                        route.handler = defaulthandler
                    }
                    break;
                case false:
                    debug(`No x-handler found for ${verb} at ${path}. Using default handler.`);
                    route.handler = defaulthandler
                    break;
                default:
                    debug(`This is odd. Something is up with ${verb} at ${path}. operation.hasOwnProperty('x-handler') is returning neither true nor false. Using default handler.`);
                    route.handler = defaulthandler
            };

            
            // if (operation['x-handler'] || def['x-handler']) {
            //         debug(`Using ${operation['x-handler'] || def['x-handler']} for ${path} ${verb}`);
            //         route.handler = operation['x-handler'] || def['x-handler'];
            //         route.handler = route.handler && resolve(options.basedir, route.handler, verb);
            //     } else {
            //         debug(`Using ${defaulthandler} for ${path} ${verb}`);
            //         route.handler = defaulthandler || undefined;
            //     }


            route.handler && routes.push(route);
        });
    });

    return routes;
}

/**
 * Match a route handler to a given path name set.
 * @param method
 * @param pathnames
 * @param handlers
 * @returns {*}
 */
function matchpath(method, pathnames, handlers) {
    if (!handlers) {
        return null;
    }
    if (pathnames.length > 1) {
        pathnames.shift();
        return matchpath(method, pathnames, handlers[pathnames[0]]);
    }

    return handlers[pathnames[0]] ? handlers[pathnames[0]] : handlers[method];
}

/**
 * Build the security definition for this route.
 * @param basedir to search for x-authorize functions from.
 * @param securityDefinitions from the api.
 * @param routeSecurity the security defined on this route.
 * @returns {*}
 */
function buildSecurity(options, securityDefinitions, routeSecurity) {
    var security = {};
    var basedir = options.basedir;

    if (!securityDefinitions || !routeSecurity || !thing.isArray(routeSecurity)) {
        return undefined;
    }

    routeSecurity.forEach(function (definition) {
        Object.keys(definition).forEach(function (defName) {
            assert.ok(securityDefinitions[defName], 'Unrecognized security definition (' + defName + ')');

            security[defName] = {};
            //The value of security scheme is a list of scope names required for the execution
            security[defName].scopes = definition[defName];

            security[defName].scopes.forEach(function (scope) {
                assert.ok(thing.isString(scope) && Object.keys(securityDefinitions[defName].scopes).indexOf(scope) > -1, 'Unrecognized scope (' + scope + ').');
            });

            if (options.security) {
                //Security options found
                //Resolve the security authorize handler path - basedir + options.security + securityDefinition name
                security[defName].authorize = resolve(basedir, path.join(options.security, defName + '.js'));
            }
            //'x-authorize' can override the 'security' options and default handlers.
            if (securityDefinitions[defName]['x-authorize']) {
                security[defName].authorize = resolve(basedir, securityDefinitions[defName]['x-authorize']);
            }
        });
    });

    return security;
}

/**
 * Resolve the given path into a function.
 * @param basedir to search from.
 * @param pathname to resolve.
 * @param method
 * @returns {*}
 */
function resolve(basedir, pathname, method) {
    var handler;
    try {
        //If the pathname is already a resolved function, return it.
        //In the case of x-handler and x-authorize, users can define
        //external handler/authorize modules and functions OR override
        //existing x-authorize functions.
        if (thing.isFunction(pathname)) {
            return pathname;
        }

        pathname = path.resolve(basedir, pathname);
        handler = require(pathname);

        if (thing.isFunction(handler)) {
            return handler;
        }

        return method && handler[method];
    }
    catch (error) {
        utils.debuglog('Could not find %s.', pathname);
        return;
    }
}

module.exports = buildroutes;
