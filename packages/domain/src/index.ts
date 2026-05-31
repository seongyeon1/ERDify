export { createEmptyDiagram } from "./schema/create-empty-diagram.js";
export { validateDiagram } from "./validation/validate-diagram.js";
export { analyzeSchema } from "./utils/analyze-schema.js";
export type { SchemaFinding } from "./utils/analyze-schema.js";
export { selectRelevantTables } from "./utils/select-relevant-tables.js";
export { detectConventions } from "./utils/detect-conventions.js";
export type { ConventionProfile } from "./utils/detect-conventions.js";
export { addEntity, renameEntity, removeEntity, updateEntityColor, updateEntityComment, setEntitySchema, setSeedData } from "./commands/entity-commands.js";
export { addColumn, addColumns, updateColumn, removeColumn } from "./commands/column-commands.js";
export { addRelationship, removeRelationship, updateRelationship } from "./commands/relationship-commands.js";
export { updateEntityPosition } from "./commands/layout-commands.js";
export { addIndex, removeIndex, updateIndex } from "./commands/index-commands.js";
export type {
  DiagramColumn,
  DiagramDialect,
  DiagramDocument,
  DiagramEntity,
  DiagramIndex,
  DiagramLayout,
  DiagramMetadata,
  DiagramRelationship,
  DiagramValidationResult,
  EntityPosition,
  ReferentialAction,
  RelationshipCardinality,
  SeedRow,
} from "./types/index.js";
export { formatDiagram } from "./utils/format-diagram.js";
export { generateDdl } from "./utils/ddl-generator.js";
export { generateSeedSql, generateSetupSql } from "./utils/seed-generator.js";
export { generateOrm } from "./utils/orm-generator.js";
export type { OrmType } from "./utils/orm-generator.js";
