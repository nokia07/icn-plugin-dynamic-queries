// Pruebas de QuerySerializer.build (conversión del estado del constructor de ICN al contrato de la API).
// Ejecutar: node test/QuerySerializer.test.js
const assert = require("assert");
const path = require("path");
let mod;
// El módulo es AMD (Dojo); este define mínimo le inyecta el equivalente de dojo/_base/array.
global.define = (deps, f) => { mod = f({ map: (a, fn) => a.map(fn), filter: (a, fn) => a.filter(fn) }); };
require(path.join(__dirname, "../src/co/com/portalup/extension/WebContent/dynamicQueriesDojo/QuerySerializer.js"));
const S = mod;
const base = () => ({
  repository: { id: "Proteccion", objectStoreName: "Proteccion" },
  folder: { item: { id: "Folder,{B879},{0F1E}" }, path: "\\Proteccion", includeSubfolders: true },
  contentClass: { id: "Document", name: "Documento" }, includeSubclasses: true,
  moreOptions: { objectType: "document", versionOption: "releasedversion" }, matchAll: true,
  resultsDisplay: { columns: ["{NAME}", "DateCreated"], sortBy: "{NAME}", sortAsc: true },
  criteria: []
});
const c = (id, type, op, values, name) => ({ id, name: name || id, dataType: type, selectedOperator: op, values });

// 1. Condición + grupo OR anidado + fila vacía ignorada + conversión de números
let st = base();
st.criteria = [
  c("DocumentTitle", "xs:string", "STARTSWITH", ["POL-", ""], "Título del documento"),
  { anded: false, criteria: [c("Linea", "xs:string", "EQUAL", ["VIDA", ""]), c("Linea", "xs:string", "EQUAL", ["", ""]), c("Aviso", "xs:integer", "INANY", ["1", "2", ""])] },
  c("Vacia", "xs:string", "EQUAL", [""])
];
let r = S.build(st);
assert.deepStrictEqual(r.errors, []);
assert.deepStrictEqual(r.definition.scope, { folderId: "{0F1E}", folderPath: "\\Proteccion", includeSubfolders: true });
assert.strictEqual(r.definition.criteria.length, 2);
assert.deepStrictEqual(r.definition.criteria[0], { type: "condition", property: "DocumentTitle", label: "Título del documento", dataType: "STRING", operator: "STARTS_WITH", values: ["POL-"] });
assert.strictEqual(r.definition.criteria[1].match, "ANY");
assert.strictEqual(r.definition.criteria[1].criteria.length, 2);
assert.deepStrictEqual(r.definition.criteria[1].criteria[1].values, [1, 2]);
assert.strictEqual(r.definition.versionSelection, "releasedVersion");
assert.strictEqual(r.definition.match, "ALL");
assert.deepStrictEqual(r.definition.resultsDisplay, { columns: ["{NAME}", "DateCreated"], sortBy: "{NAME}", sortAscending: true });

// 2. BETWEEN con un solo valor → error; IS_NULL sin valores → válido
st = base(); st.matchAll = false;
st.criteria = [c("DateCreated", "xs:timestamp", "BETWEEN", ["2026-03-15T00:00:00.000-05:00", ""], "Añadido el"), c("Asunto", "xs:string", "NULL", [""])];
r = S.build(st);
assert.deepStrictEqual(r.errors, ["“Añadido el”: el operador de rango requiere dos valores."]);
assert.deepStrictEqual(r.definition.criteria, [{ type: "condition", property: "Asunto", label: "Asunto", dataType: "STRING", operator: "IS_NULL", values: [] }]);
assert.strictEqual(r.definition.match, "ANY");

// 3. BETWEEN completo, booleano, sin carpeta
st = base(); st.folder = null;
st.criteria = [c("DateCreated", "xs:timestamp", "BETWEEN", ["2026-01-01T00:00:00.000-05:00", "2026-12-31T00:00:00.000-05:00", ""]), c("ClienteVIP", "xs:boolean", "EQUAL", ["true"])];
r = S.build(st);
assert.deepStrictEqual(r.errors, []);
assert.strictEqual(r.definition.scope, undefined);
assert.strictEqual(r.definition.criteria[0].values.length, 2);
assert.deepStrictEqual(r.definition.criteria[1].values, [true]);

// 4. Solo filas vacías → error; operador desconocido → error
st = base(); st.criteria = [c("DocumentTitle", "xs:string", "STARTSWITH", ["", ""])];
assert.deepStrictEqual(S.build(st).errors, ["Defina al menos una condición con valor."]);
st.criteria = [c("X", "xs:string", "FOO", ["a"])];
assert.deepStrictEqual(S.build(st).errors, ["“X”: operador FOO o tipo xs:string no soportado."]);

// 5. Sin clase
st = base(); st.contentClass = null; st.criteria = [c("A", "xs:string", "EQUAL", ["x"])];
assert.deepStrictEqual(S.build(st).errors, ["Seleccione una clase."]);
console.log("OK: 5 casos");
