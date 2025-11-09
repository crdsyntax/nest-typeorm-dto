#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (!args[0]) {
  console.error('❌ Please provide the module name. Example: node bin/generate-dto.js reserva');
  process.exit(1);
}

const rawName = args[0];
const kebabName = rawName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
const srcDir = path.resolve(process.cwd(), 'src');

function findEntityFiles(moduleName) {
  const candidates = [
    path.join(srcDir, moduleName, 'entities'),
    path.join(srcDir, moduleName, 'entity'),
  ];

  let files = [];
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.entity.ts'));
      if (files.length > 0) return files.map(f => path.join(dir, f));
    }
  }

  function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fp = path.join(dir, file);
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) {
        results = results.concat(walk(fp));
      } else if (stat.isFile() && file.endsWith('.entity.ts')) {
        results.push(fp);
      }
    }
    return results;
  }

  return walk(srcDir);
}

function relationField(line) {
  const relMatch = line.match(/@(ManyToOne|OneToMany|ManyToMany|OneToOne)\s*\(\s*\(\)\s*=>\s*([A-Za-z0-9_]+)\s*[,)]/);
  if (!relMatch) return null;
  const type = relMatch[1];
  const target = relMatch[2];
  if (type === 'ManyToOne' || type === 'OneToOne') return { name: `${target.charAt(0).toLowerCase() + target.slice(1)}Id`, isArray: false };
  if (type === 'OneToMany' || type === 'ManyToMany') return { name: `${target.charAt(0).toLowerCase() + target.slice(1)}Ids`, isArray: true };
  return null;
}

function mapType(typeRaw, propName, isRelation = false, isArray = false) {
  if (isRelation) return isArray ? `${propName}: number[];` : `${propName}: number;`;
  const t = typeRaw.replace(/<.*>/, '').trim();
  if (/string|varchar|text/i.test(t)) return `${propName}: string;`;
  if (/number|int|decimal|float|double|numeric|smallint|bigint/i.test(t)) return `${propName}: number;`;
  if (/boolean|true|false/i.test(t)) return `${propName}: boolean;`;
  if (/Date|datetime|timestamp/i.test(t)) return `${propName}: string;`;
  if (/\[\]$/.test(t) || /Array\</.test(typeRaw)) return `${propName}: any[];`;
  return `${propName}: any;`;
}

const entityFiles = findEntityFiles(kebabName);
if (!entityFiles.length) {
  console.error('❌ Could not find any entity file for module:', rawName);
  process.exit(2);
}

entityFiles.forEach(entityFile => {
  const entityContent = fs.readFileSync(entityFile, 'utf8');
  const lines = entityContent.split('\n');

  const props = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const rel = relationField(line);
    if (rel) {
      props.push({ name: rel.name, typeRaw: '', isRelation: true, isArray: rel.isArray });
      continue;
    }
    const propMatch = line.match(/(?:public\s+|protected\s+|private\s+)?([a-zA-Z0-9_]+)\??:\s*([^;\n]+);/);
    if (propMatch) {
      props.push({ name: propMatch[1], typeRaw: propMatch[2].trim(), isRelation: false, isArray: false });
    }
  }

  if (!props.length) {
    console.warn(`⚠️ No properties parsed from entity file: ${entityFile}, skipping...`);
    return;
  }

  const entityBaseName = path.basename(entityFile, '.entity.ts');
  const className = entityBaseName.charAt(0).toUpperCase() + entityBaseName.slice(1);
  const createDtoName = `Create${className}Dto`;
  const updateDtoName = `Update${className}Dto`;

  const dtoBaseDir = path.join(path.dirname(entityFile), '..', 'dto', entityBaseName);
  if (!fs.existsSync(dtoBaseDir)) fs.mkdirSync(dtoBaseDir, { recursive: true });

  const dtoLines = props.map(p => {
    return [
      `  @ApiPropertyOptional()`,
      `  @IsOptional()`,
      `  ${mapType(p.typeRaw, p.name, p.isRelation, p.isArray)}`
    ].join('\n');
  });

  const validatorImports = ['IsOptional', 'ApiPropertyOptional'];

  const createDtoContent = `import { ApiPropertyOptional } from '@nestjs/swagger';\nimport { ${validatorImports.join(', ')} } from 'class-validator';\n\nexport class ${createDtoName} {\n\n${dtoLines.join('\n\n')}\n}\n`;
  const updateDtoContent = `import { PartialType } from '@nestjs/mapped-types';\nimport { ${createDtoName} } from './${createDtoName}';\n\nexport class ${updateDtoName} extends PartialType(${createDtoName}) {}\n`;

  const createDtoPath = path.join(dtoBaseDir, `create-${entityBaseName}.dto.ts`);
  const updateDtoPath = path.join(dtoBaseDir, `update-${entityBaseName}.dto.ts`);

  fs.writeFileSync(createDtoPath, createDtoContent, 'utf8');
  fs.writeFileSync(updateDtoPath, updateDtoContent, 'utf8');

  console.log(`✅ DTOs generated for entity '${entityBaseName}':`);
  console.log(' -', createDtoPath);
  console.log(' -', updateDtoPath);
});
