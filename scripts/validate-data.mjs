#!/usr/bin/env node
/**
 * Validates catalog.json and raw source files against the JSON schema.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataDir = join(root, 'data');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const schema = JSON.parse(readFileSync(join(dataDir, 'schema', 'component-catalog.schema.json'), 'utf8'));
delete schema.$schema;
delete schema.$id;
const validateCatalog = ajv.compile(schema);

function check(name, path, validator) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const valid = validator(data);
  if (!valid) {
    console.error(`FAIL ${name}:`);
    for (const err of validator.errors ?? []) {
      console.error(`  ${err.instancePath || '/'} ${err.message}`);
    }
    return false;
  }
  console.log(`OK   ${name}`);
  return true;
}

const rawSchema = {
  type: 'object',
  required: ['source', 'extractedAt', 'origin', 'components'],
  properties: {
    source: { enum: ['cg', 'ds', 'es'] },
    extractedAt: { type: 'string' },
    origin: { type: 'object' },
    components: { type: 'array' },
    familiesGuess: { type: 'object' },
  },
};
const validateRaw = ajv.compile(rawSchema);

const validateFoundations = ajv.compile({
  type: 'object',
  required: ['meta', 'sections'],
  properties: {
    meta: { type: 'object' },
    sections: {
      type: 'object',
      required: ['colors', 'typography', 'spacing'],
      properties: {
        colors: { type: 'object' },
        typography: { type: 'object' },
        spacing: { type: 'object' },
      },
    },
  },
});

let ok = true;
ok = check('catalog.json', join(dataDir, 'catalog.json'), validateCatalog) && ok;
for (const src of ['cg', 'ds', 'es']) {
  ok = check(`${src}.raw.json`, join(dataDir, 'sources', `${src}.raw.json`), validateRaw) && ok;
}

ok = check('foundations.json', join(dataDir, 'foundations.json'), validateFoundations) && ok;

if (!ok) process.exit(1);
console.log('All data files valid.');
