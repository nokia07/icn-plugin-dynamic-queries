// Pruebas de QuerySerializer.build (conversión del estado del constructor de ICN al contrato de la API).
// Ejecutar: node test/QuerySerializer.test.js
const assert = require("assert");
const path = require("path");
let mod;
// El módulo es AMD (Dojo); este define mínimo le inyecta el equivalente de dojo/_base/array y un SearchTemplate falso.
class FakeSearchTemplate {
  constructor(args) { Object.assign(this, args); }
  _applyRetrievedSearchCriteria(icnSearch) { this.applied = icnSearch; }
}
global.define = (deps, f) => { mod = f({ map: (a, fn) => a.map(fn), filter: (a, fn) => a.filter(fn) }, FakeSearchTemplate); };
require(path.join(__dirname, "../src/co/com/portalup/extension/WebContent/dynamicQueriesDojo/QuerySerializer.js"));
const S = mod;
const base = () => ({
  repository: { id: "Proteccion", objectStoreName: "Proteccion", objectStoreId: "{B879}" },
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
assert.deepStrictEqual(r.definition.scope, { folderId: "{0F1E}", folderPath: "/", includeSubfolders: true });
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
// 6. Ruta de carpeta: PathName del item si viene; si no, se deduce de la ruta que muestra ICN
st = base(); st.criteria = [c("A", "xs:string", "EQUAL", ["x"])];
st.folder = { item: { id: "Folder,{B879},{80A2}", attributes: { PathName: "/Carga CRM" } }, path: "\\Proteccion\\Carga CRM", includeSubfolders: false };
assert.strictEqual(S.build(st).definition.scope.folderPath, "/Carga CRM");
st.folder = { item: { id: "Folder,{B879},{80A2}" }, path: "\\Proteccion\\Carga CRM\\2026", includeSubfolders: false };
assert.strictEqual(S.build(st).definition.scope.folderPath, "/Carga CRM/2026");

// 7. Ida y vuelta: build → toIcnSearch devuelve el formato de ICN con los mismos datos
st = base(); st.matchAll = false;
st.moreOptions = { objectType: "document", versionOption: "allversions" };
st.criteria = [
  c("DocumentTitle", "xs:string", "STARTSWITH", ["POL-", ""], "Título del documento"),
  c("DateCreated", "xs:timestamp", "BETWEEN", ["2026-01-01T00:00:00.000-05:00", "2026-12-31T00:00:00.000-05:00"], "Añadido el"),
  { anded: true, criteria: [c("Aviso", "xs:integer", "GREATER", ["5"]), c("ClienteVIP", "xs:boolean", "EQUAL", ["true"])] }
];
const def = S.build(st).definition;
const icn = S.toIcnSearch(def, st.repository);
assert.strictEqual(icn.andSearch, false);
assert.deepStrictEqual(icn.search_classes, [{ name: "Document", displayName: "Documento", searchSubclasses: true, objectType: "document" }]);
assert.deepStrictEqual(icn.search_folders, [{ id: "{0F1E}", pathName: "/", objectStoreId: "{B879}", objectStoreName: "Proteccion", searchSubfolders: true, view: "editable" }]);
assert.deepStrictEqual(icn.moreOptions, { objectType: "document", versionOption: "allversions" });
assert.deepStrictEqual(icn.criterias[0], { name: "DocumentTitle", label: "Título del documento", dataType: "xs:string", selectedOperator: "STARTSWITH", values: ["POL-"] });
assert.deepStrictEqual(icn.criterias[1].values, ["2026-01-01T00:00:00.000-05:00", "2026-12-31T00:00:00.000-05:00"]);
assert.strictEqual(icn.criterias[2].anded, true);
assert.deepStrictEqual(icn.criterias[2].searchCriteria.map(x => [x.name, x.selectedOperator, x.values]), [["Aviso", "GREATER", ["5"]], ["ClienteVIP", "EQUAL", ["true"]]]);
assert.deepStrictEqual(icn.resultsDisplay, { columns: ["{NAME}", "DateCreated"], sortBy: "{NAME}", sortAsc: true });
// Y de vuelta: los criterios de ICN (con values de texto) producen la misma definición
const back = base(); back.matchAll = icn.andSearch; back.moreOptions = icn.moreOptions;
const toCriterion = (n) => n.searchCriteria ? { anded: n.anded, criteria: n.searchCriteria.map(toCriterion) } : { id: n.name, name: n.label, dataType: n.dataType, selectedOperator: n.selectedOperator, values: n.values.concat([""]) };
back.criteria = icn.criterias.map(toCriterion);
assert.deepStrictEqual(S.build(back).definition.criteria, def.criteria);

// 8. toSearchTemplate aplica el formato de ICN a una plantilla nueva; operadores desconocidos → Error
const tpl = S.toSearchTemplate(def, st.repository, "Pólizas");
assert.ok(/^NewSearch_dq_/.test(tpl.id) && tpl.name === "Pólizas" && tpl.applied.criterias.length === 3);
assert.throws(() => S.toIcnSearch(Object.assign({}, def, { criteria: [{ type: "condition", property: "X", dataType: "STRING", operator: "SOUNDS_LIKE", values: ["a"] }] }), st.repository), /no reconoce/);
console.log("OK: 8 casos");
