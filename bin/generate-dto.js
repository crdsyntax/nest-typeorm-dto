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

function toPascalCase(str) {
  return str
    .split(/-|_/)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

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
      if (stat.isDirectory()) results = results.concat(walk(fp));
      else if (stat.isFile() && file.endsWith('.entity.ts')) results.push(fp);
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
  if (type === 'ManyToOne' || type === 'OneToOne') return { name: `${target.charAt(0).toLowerCase() + target.slice(1)}Id`, type: 'number', isArray: false, isOptional: false, isRelation: true };
  if (type === 'OneToMany' || type === 'ManyToMany') return { name: `${target.charAt(0).toLowerCase() + target.slice(1)}Ids`, type: 'number', isArray: true, isOptional: false, isRelation: true };
  return null;
}

function parseProps(entityContent) {
  const lines = entityContent.split('\n');
  const props = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const rel = relationField(line);
    if (rel) {
      props.push(rel);
      continue;
    }

    const propMatch = line.match(/(?:public\s+|protected\s+|private\s+)?([a-zA-Z0-9_]+)\??:\s*([^;\n]+);/);
    if (propMatch) {
      const name = propMatch[1];
      let type = propMatch[2].trim();
      let isOptional = line.includes('?') || false;

      if (/string|varchar|text/i.test(type)) type = 'string';
      else if (/number|int|decimal|float|double|numeric|smallint|bigint/i.test(type)) type = 'number';
      else if (/boolean|true|false/i.test(type)) type = 'boolean';
      else if (/Date|datetime|timestamp/i.test(type)) type = 'Date';
      else if (/\[\]$/.test(type) || /Array\</.test(type)) type = 'array';
      else type = 'any';

      props.push({ name, type, isOptional, isArray: type === 'array', isRelation: false });
    }
  }

  return props;
}

const entityFiles = findEntityFiles(kebabName);
if (!entityFiles.length) {
  console.error('❌ Could not find any entity file for module:', rawName);
  process.exit(2);
}

entityFiles.forEach(entityFile => {
  const entityContent = fs.readFileSync(entityFile, 'utf8');
  const props = parseProps(entityContent);

  if (!props.length) {
    console.warn(`⚠️ No properties parsed from entity file: ${entityFile}, skipping...`);
    return;
  }

  const entityBaseName = path.basename(entityFile, '.entity.ts');
  const className = toPascalCase(entityBaseName);
  const createDtoName = `Create${className}Dto`;
  const updateDtoName = `Update${className}Dto`;

  const dtoBaseDir = path.join(path.dirname(entityFile), '..', 'dto', entityBaseName);
  if (!fs.existsSync(dtoBaseDir)) fs.mkdirSync(dtoBaseDir, { recursive: true });

  let dtoContent = '';
  const validatorImports = new Set();
  validatorImports.add('IsOptional');
  validatorImports.add('IsNotEmpty');
  validatorImports.add('ApiProperty');
  validatorImports.add('ApiPropertyOptional');
  validatorImports.add('IsString');
  validatorImports.add('IsNumber');
  validatorImports.add('IsPositive');
  validatorImports.add('IsBoolean');
  validatorImports.add('IsDate');
  validatorImports.add('IsArray');
  validatorImports.add('Type');

  props.forEach(prop => {
    const decorators = [];
    const validators = [];

    if (prop.isOptional) decorators.push(`  @ApiPropertyOptional({ description: '${prop.name} field' })`);
    else decorators.push(`  @ApiProperty({ description: '${prop.name} field' })`);

    if (prop.isOptional) validators.push(`  @IsOptional()`);
    else validators.push(`  @IsNotEmpty({ message: '${prop.name} should not be empty' })`);

    switch (prop.type) {
      case 'string': validators.push(`  @IsString({ message: '${prop.name} should be a valid string' })`); break;
      case 'number':
        validators.push(`  @IsNumber({}, { message: '${prop.name} should be a valid number' })`);
        if (!prop.isOptional && !prop.isArray) validators.push(`  @IsPositive({ message: '${prop.name} should be a positive number' })`);
        break;
      case 'boolean': validators.push(`  @IsBoolean({ message: '${prop.name} should be a valid boolean' })`); break;
      case 'Date': validators.push(`  @IsDate({ message: '${prop.name} should be a valid date' })`); break;
      case 'array': validators.push(`  @IsArray({ message: '${prop.name} should be a valid array' })`); break;
    }

    if (prop.isRelation) {
      validators.push(`  @Type(() => Number)`);
    }

    decorators.forEach(d => dtoContent += `${d}\n`);
    validators.forEach(v => dtoContent += `${v}\n`);
    dtoContent += `  ${prop.name}: ${prop.type}${prop.isArray ? '[]' : ''};\n\n`;
  });

  const createDtoPath = path.join(dtoBaseDir, `create-${entityBaseName}.dto.ts`);
  const updateDtoPath = path.join(dtoBaseDir, `update-${entityBaseName}.dto.ts`);

  const createDtoFull = `import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';\nimport { Type } from 'class-transformer';\nimport { ${[...validatorImports].join(', ')} } from 'class-validator';\n\nexport class ${createDtoName} {\n\n${dtoContent}}\n`;
  const updateDtoFull = `import { PartialType } from '@nestjs/mapped-types';\nimport { ${createDtoName} } from './${createDtoName}';\n\nexport class ${updateDtoName} extends PartialType(${createDtoName}) {}\n`;

  fs.writeFileSync(createDtoPath, createDtoFull, 'utf8');
  fs.writeFileSync(updateDtoPath, updateDtoFull, 'utf8');

  console.log(`✅ DTOs generated for entity '${entityBaseName}' (class: ${className}):`);
  console.log(' -', createDtoPath);
  console.log(' -', updateDtoPath);
});
