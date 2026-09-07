/**
 * Reading the schema files under `sql/schemas/`.
 *
 * Exported from the package because anything that creates a conforming database
 * -- the app, the module converters, an external tool -- needs to expand the
 * include directives the schemas use. See {@link loadSchemaSql}.
 */

export { loadSchemaSql, SchemaLoadError } from './loadSchemaSql';
