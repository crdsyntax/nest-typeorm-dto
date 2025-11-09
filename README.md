# generate-dto.js — DTO generator for TypeORM entities

This repository contains a small Node.js script that automates the creation of Swagger/class-validator DTOs from TypeORM entity files.

Script path
- `bin/generate-dto.js`

Quick summary
- Purpose: Read one or more `.entity.ts` files belonging to a module and generate Create and Update DTOs decorated with `@ApiPropertyOptional()` (Swagger) and `class-validator` decorators (with validation messages).
- Output: For each parsed entity the script writes two files:
  - `create-<entityBaseName>.dto.ts` (contains property declarations with @ApiPropertyOptional and validators)
  - `update-<entityBaseName>.dto.ts` (extends `PartialType(CreateXDto)`)

Requirements
- Node.js (any modern version)
- A NestJS/TypeScript project layout with a `src/` folder and entity files named `*.entity.ts`.
- The project is expected to use (or install) these packages if you want to compile the generated DTOs without changes:
  - `@nestjs/swagger`
  - `class-validator`
  - `@nestjs/mapped-types` (for `PartialType`)

How it works
- The script accepts a single argument: the module name. Example:

```bash
node ./bin/generate-dto.js reserva
```

- It searches for entity files in common locations and falls back to walking the `src/` tree to locate files ending with `.entity.ts`.
- For each entity file it:
  1. Reads the file and scans lines for property declarations (simple pattern matching for `propName: Type;`).
  2. Detects some TypeORM relation decorators like `@ManyToOne`, `@OneToMany`, `@OneToOne`, and `@ManyToMany` and maps them to ID(s) fields (e.g. `cliente: Client` relation becomes `clienteId: number` or `clienteIds: number[]`).
  3. Maps property types to primitive DTO types and validation decorators:
     - string-like types -> `string` + `@IsString({ message: "should be a valid string" })`
     - numeric types -> `number` + `@IsNumber({}, { message: "should be a valid number" })`
     - boolean -> `boolean` + `@IsBoolean({ message: "should be a valid boolean" })`
     - Date-like -> `string` + `@IsDateString({ message: "should be a valid ISO date string" })`
     - arrays -> `any[]` + `@IsArray({ message: "should be a valid array" })`
     - fallback -> `any` (no strong validator)
  4. Adds `@ApiPropertyOptional()` and `@IsOptional()` for all fields (the generated Create DTOs have optional properties by design in this script) and writes the DTO files to a `dto` folder near the entity.

Generated file layout
If an entity file is located at `src/reserva/entities/booking.entity.ts`, the script will create (by default):

```
src/reserva/dto/booking/create-booking.dto.ts
src/reserva/dto/booking/update-booking.dto.ts
```

Note: the script organizes DTOs into a `dto/<entityBaseName>/` subfolder to avoid name collisions when multiple entities exist.

Limitations & parsing details
- The generator uses simple regex-based parsing of the entity source. It works well for straightforward property declarations like:

```ts
  id: number;
  name: string;
  created_at: Date;
```

- It is heuristic-based and may fail or produce suboptimal output for complex TypeScript features, including:
  - computed properties, getters/setters, or methods
  - properties declared using `=` initializers (the regex expects `prop: Type;` lines)
  - union/intersection/complex generic types
  - advanced relation patterns or decorator syntax not matched by the relation detector

- Relation handling: when a relation decorator is detected, the script creates an `...Id` (or `...Ids`) numeric field rather than nested objects. If you prefer nested DTOs or `ValidateNested()` + `Type(() => ...)`, the script can be extended.

Recommendations & suggested improvements
- Use the TypeScript Compiler API (ts-morph or typescript) for robust AST-based parsing if you need reliable output for complex entities.
- Add flags to the script:
  - `--force` to overwrite existing DTOs
  - `--out <path>` to control output folder
  - `--nested-relations` to produce nested DTOs instead of id fields
- Add tests: generate DTOs into a temporary directory and compile them to detect missing imports or type errors.

Troubleshooting
- If no entities are found, make sure you ran the script from the project root and that `src/` exists and contains `.entity.ts` files.
- If validators or swagger decorators are missing at compile time, install the required packages listed above.

Example

```bash
# Generate DTOs for the reservation module
node ./bin/generate-dto.js reserva

# Output (example):
# ✅ DTOs generated for entity 'booking':
#  - src/reserva/dto/booking/create-booking.dto.ts
#  - src/reserva/dto/booking/update-booking.dto.ts
```

If you'd like, I can now:
- Replace the regex parsing with a TypeScript AST parser for more accurate type extraction.
- Add a `--force` option and better naming conventions (e.g., put DTOs directly under `src/<module>/dto/`).
