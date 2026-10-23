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
global.define = (deps, f) => { mod = f({ map: (a, fn) => a.map(fn), filter: (a, fn) => a.filter(fn), forEach: (a, fn) => a.forEach(fn), indexOf: (a, v) => a.indexOf(v) }, FakeSearchTemplate); };
require(path.join(__dirname, "../src/co/com/portalup/extension/WebContent/dynamicQueriesDojo/QuerySerializer.js"));
const S = mod;
// Comodines como los arma el diálogo ({ clave: { name, order } }) a partir de { clave: nombre }.
const wildcards = names => Object.fromEntries(Object.entries(names).map(([key, name]) => [key, { name }]));
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
// Compacta: la raíz con subcarpetas no se guarda, ni el nombre visible de la clase ni el label de las condiciones
assert.strictEqual(r.definition.scope, undefined);
assert.deepStrictEqual(r.definition.documentClass, { symbolicName: "Document", includeSubclasses: true });
assert.strictEqual(r.definition.criteria.length, 2);
assert.deepStrictEqual(r.definition.criteria[0], { type: "condition", property: "DocumentTitle", dataType: "STRING", operator: "STARTS_WITH", values: ["POL-"] });
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
assert.deepStrictEqual(r.definition.criteria, [{ type: "condition", property: "Asunto", dataType: "STRING", operator: "IS_NULL", values: [] }]);
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
// La raíz sin subcarpetas sí restringe (solo lo archivado en la raíz): se guarda
st.folder = { item: { id: "Folder,{B879},{0F1E}" }, path: "\\Proteccion", includeSubfolders: false };
assert.deepStrictEqual(S.build(st).definition.scope, { folderId: "{0F1E}", folderPath: "/", includeSubfolders: false });

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
assert.deepStrictEqual(icn.search_classes, [{ name: "Document", displayName: "Document", searchSubclasses: true, objectType: "document" }]);
assert.strictEqual(icn.search_folders, undefined);
assert.deepStrictEqual(icn.moreOptions, { objectType: "document", versionOption: "allversions" });
assert.deepStrictEqual(icn.criterias[0], { name: "DocumentTitle", label: "DocumentTitle", dataType: "xs:string", selectedOperator: "STARTSWITH", values: ["POL-"] });
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
// Marcas para que QueryTab restaure la clase (ICN la ignora en las búsquedas nuevas) y "Incluir subclases"
assert.strictEqual(tpl.dqRestoreClass, true);
assert.strictEqual(tpl.dqIncludeSubclasses, true);
assert.throws(() => S.toIcnSearch(Object.assign({}, def, { criteria: [{ type: "condition", property: "X", dataType: "STRING", operator: "SOUNDS_LIKE", values: ["a"] }] }), st.repository), /no reconoce/);

// 9. toCeSql: columnas ({NAME} → DocumentTitle, Id siempre primero), subclases, grupos OR, literales, carpeta, versión, orden
const sqlDef = {
  documentClass: { symbolicName: "Poliza", includeSubclasses: false },
  match: "ALL",
  criteria: [
    { type: "condition", property: "DocumentTitle", dataType: "STRING", operator: "STARTS_WITH", values: ["O'Brien"] },
    { type: "group", match: "ANY", criteria: [
      { type: "condition", property: "Aviso", dataType: "INTEGER", operator: "IN", values: [1, 2] },
      { type: "condition", property: "ClienteVIP", dataType: "BOOLEAN", operator: "EQUAL", values: [true] }
    ] },
    { type: "condition", property: "DateCreated", dataType: "DATETIME", operator: "BETWEEN", values: ["2026-01-01T00:00:00.000-05:00", "2026-12-31T00:00:00.000-05:00"] },
    { type: "condition", property: "Asunto", dataType: "STRING", operator: "IS_NULL", values: [] }
  ],
  scope: { folderPath: "/Carga CRM", includeSubfolders: true },
  versionSelection: "releasedVersion",
  resultsDisplay: { columns: ["{NAME}", "DateCreated"], sortBy: "DateCreated", sortAscending: false }
};
assert.strictEqual(S.toCeSql(sqlDef),
  "SELECT d.[Id], d.[DocumentTitle], d.[DateCreated] FROM [Poliza] d WITH EXCLUDESUBCLASSES" +
  " WHERE d.[DocumentTitle] LIKE 'O''Brien%' AND ((d.[Aviso] = 1 OR d.[Aviso] = 2) OR d.[ClienteVIP] = TRUE)" +
  " AND (d.[DateCreated] >= 20260101T050000Z AND d.[DateCreated] <= 20261231T050000Z) AND d.[Asunto] IS NULL" +
  " AND d.This INSUBFOLDER '/Carga CRM' AND d.[VersionStatus] = 1 ORDER BY d.[DateCreated] DESC");

// 10. Coincidencia "cualquiera" en la raíz va entre paréntesis para no mezclarse con versión/carpeta; sin columnas → Id y nombre
assert.strictEqual(S.toCeSql({
  documentClass: { symbolicName: "Document", includeSubclasses: true }, match: "ANY", versionSelection: "allVersions",
  criteria: [
    { type: "condition", property: "A", dataType: "STRING", operator: "NOT_CONTAINS", values: ["x"] },
    { type: "condition", property: "B", dataType: "FLOAT", operator: "NOT_BETWEEN", values: [1.5, 2] }
  ]
}), "SELECT d.[Id], d.[DocumentTitle] FROM [Document] d WITH INCLUDESUBCLASSES" +
  " WHERE (NOT (d.[A] LIKE '%x%') OR NOT (d.[B] >= 1.5 AND d.[B] <= 2))");
assert.throws(() => S.toCeSql(Object.assign({}, sqlDef, { criteria: [{ type: "condition", property: "D", dataType: "DATETIME", operator: "EQUAL", values: ["mañana"] }] })), /Fecha no válida/);

// 11. La definición de prueba 7 también se convierte (la que produce el constructor)
assert.ok(/^SELECT d\.\[Id\], d\.\[DocumentTitle\], d\.\[DateCreated\] FROM \[Document\] d WITH INCLUDESUBCLASSES WHERE /.test(S.toCeSql(def)));
// 12. Comodines: la condición conserva su valor de ejemplo y lleva el nombre; el CE SQL usa #Nombre (con comillas en
// texto y en LIKE, sin comillas en números y fechas), como en CG_CFG_QUERY. Las claves cuentan solo condiciones con valor.
st = base();
st.criteria = [
  c("Vacia", "xs:string", "EQUAL", [""]),
  c("NroIdentificacion", "xs:string", "EQUAL", ["71234567", ""]),
  c("TipoIdentificacion", "xs:string", "EQUAL", ["CC", ""]),
  c("Alcance", "xs:string", "EQUAL", ["A", ""]),
  { anded: false, criteria: [c("Monto", "xs:integer", "GREATER", ["10", ""]), c("Nombre", "xs:string", "LIKE", ["ana", ""])] },
  c("Fecha", "xs:timestamp", "LESS", ["2026-03-15T00:00:00.000-05:00", ""])
];
st.parameters = wildcards({ "NroIdentificacion#1": "NroIdentificacion", "TipoIdentificacion#1": "TipoIdentificacion", "Monto#1": "MontoMin", "Nombre#1": "Nombre", "Fecha#1": "Hasta" });
r = S.build(st);
assert.deepStrictEqual(r.errors, []);
assert.deepStrictEqual(r.definition.criteria[0], { type: "condition", property: "NroIdentificacion", dataType: "STRING", operator: "EQUAL", values: ["71234567"], label: "NroIdentificacion", parameter: "NroIdentificacion" });
assert.deepStrictEqual(r.definition.criteria[2], { type: "condition", property: "Alcance", dataType: "STRING", operator: "EQUAL", values: ["A"] });
assert.strictEqual(S.toCeSql(r.definition).split(" WHERE ")[1],
  "d.[NroIdentificacion] = '#NroIdentificacion' AND d.[TipoIdentificacion] = '#TipoIdentificacion' AND d.[Alcance] = 'A'" +
  " AND (d.[Monto] > #MontoMin OR d.[Nombre] LIKE '%#Nombre%') AND d.[Fecha] < #Hasta" +
  " AND d.[VersionStatus] = 1 ORDER BY d.[DocumentTitle] ASC");
assert.deepStrictEqual(S.getParameters(r.definition).map(p => p.name), ["NroIdentificacion", "TipoIdentificacion", "MontoMin", "Nombre", "Hasta"]);
assert.deepStrictEqual(S.getParameters(r.definition)[2], { name: "MontoMin", property: "Monto", label: "Monto", dataType: "INTEGER", operator: "GREATER", sample: 10 });
assert.deepStrictEqual(S.getConditions(r.definition).map(e => e.key), ["NroIdentificacion#1", "TipoIdentificacion#1", "Alcance#1", "Monto#1", "Nombre#1", "Fecha#1"]);
// Reabrir: las claves de getConditions reconstruyen los comodines y el resultado es el mismo
assert.deepStrictEqual(S.getWildcards(r.definition), st.parameters);
// El comodín no llega a ICN: al reabrir se ve el valor de ejemplo
assert.deepStrictEqual(S.toIcnSearch(r.definition, { objectStoreId: "{B879}", objectStoreName: "Proteccion" }).criterias[0].values, ["71234567"]);

// 13. Comodines no válidos: operador de varios valores, nombre con espacios, nombre repetido
st = base();
st.criteria = [c("A", "xs:string", "INANY", ["x", "y"]), c("B", "xs:string", "EQUAL", ["b"]), c("C", "xs:string", "EQUAL", ["c"]), c("D", "xs:string", "EQUAL", ["d"])];
st.parameters = wildcards({ "A#1": "A", "B#1": "mal nombre", "C#1": "Repetido", "D#1": "Repetido" });
r = S.build(st);
assert.strictEqual(r.errors.length, 3);
assert.ok(/no admite este operador/.test(r.errors[0]));
assert.ok(/debe empezar por una letra/.test(r.errors[1]));
assert.ok(/#Repetido está en más de una condición/.test(r.errors[2]));
assert.strictEqual(S.canBeParameter({ operator: "BETWEEN", dataType: "DATETIME" }), false);
assert.strictEqual(S.canBeParameter({ operator: "STARTS_WITH", dataType: "STRING" }), true);

// 14. Ruta de agrupación ↔ config de la asociación con el formato DSCONFIG de CG_CFG_QUERY
assert.strictEqual(S.toGroupingConfig(" Expediente Afiliado, Pensión Voluntaria ,,Afiliaciones "),
  '{ vnRoot: "Expediente Afiliado,Pensión Voluntaria,Afiliaciones" }');
assert.strictEqual(S.fromGroupingConfig('{ vnRoot: "Expediente Afiliado,Pensión Voluntaria,Afiliaciones" }'), "Expediente Afiliado,Pensión Voluntaria,Afiliaciones");
assert.strictEqual(S.fromGroupingConfig("ruta/antigua"), "ruta/antigua");
assert.strictEqual(S.fromGroupingConfig(null), "");
// Propiedades del documento en la ruta (#Nombre#)
assert.strictEqual(S.validateGroupingPath("Expediente Afiliado,Pensión Voluntaria,Afiliaciones,#NroRadicado#"), null);
assert.strictEqual(S.validateGroupingPath("Radicado #NroRadicado#,#Fecha_1#"), null);
assert.strictEqual(S.toGroupingConfig("Afiliaciones, #NroRadicado# "), '{ vnRoot: "Afiliaciones,#NroRadicado#" }');
assert.ok(/al menos una carpeta/.test(S.validateGroupingPath(" , ")));
assert.ok(/comillas/.test(S.validateGroupingPath('A,"B"')));
["A,#NroRadicado", "A,#Nro Radicado#", "A,##", "A,#1Nro#", "A,#Nro#Otro#"].forEach(function(path) {
  assert.ok(/#NombreSimbolico#/.test(S.validateGroupingPath(path)), path);
});
// 15. Tamaño: el registro de ejemplo de CG_CFG_QUERY (4 condiciones, 2 comodines) como lo arma serialize (sin
// visualización de resultados, raíz con subcarpetas): 1128 caracteres antes de compactar
st = base(); st.resultsDisplay = null; st.contentClass = { id: "Afiliaciones", name: "Afiliaciones" }; st.includeSubclasses = false;
st.criteria = [
  c("NroIdentificacion", "xs:string", "EQUAL", ["71234567", ""], "Numero de Identificacion"),
  c("TipoIdentificacion", "xs:string", "EQUAL", ["CC", ""], "Tipo de Identificacion"),
  c("Alcance", "xs:string", "EQUAL", ["A", ""], "Alcance"),
  c("LineaProducto", "xs:string", "EQUAL", ["V", ""], "Linea de Producto")
];
st.parameters = wildcards({ "NroIdentificacion#1": "NroIdentificacion", "TipoIdentificacion#1": "TipoIdentificacion" });
r = S.build(st);
assert.deepStrictEqual(r.errors, []);
const size = JSON.stringify(r.definition).length;
assert.ok(size < 1024, "config de " + size + " caracteres");
assert.strictEqual(S.toCeSql(r.definition),
  "SELECT d.[Id], d.[DocumentTitle] FROM [Afiliaciones] d WITH EXCLUDESUBCLASSES WHERE d.[NroIdentificacion] = '#NroIdentificacion'" +
  " AND d.[TipoIdentificacion] = '#TipoIdentificacion' AND d.[Alcance] = 'A' AND d.[LineaProducto] = 'V' AND d.[VersionStatus] = 1");
// 16. keepLabels (diálogo de comodines): todas las condiciones con su nombre visible; sin él, solo los comodines
st.keepLabels = true;
assert.deepStrictEqual(S.build(st).definition.criteria.map(x => x.label), ["Numero de Identificacion", "Tipo de Identificacion", "Alcance", "Linea de Producto"]);
st.keepLabels = false;
assert.deepStrictEqual(S.build(st).definition.criteria.map(x => x.label), ["Numero de Identificacion", "Tipo de Identificacion", undefined, undefined]);
// 17. Ejecutar (Resultados de consultas): comodines de la consulta guardada y CE SQL con los valores escapados
const saved = { cesql: S.toCeSql(r.definition), config: JSON.stringify(r.definition) };
const params = S.getQueryParameters(saved);
assert.deepStrictEqual(params, [
  { name: "NroIdentificacion", label: "Numero de Identificacion", dataType: "STRING", className: "Afiliaciones", property: "NroIdentificacion" },
  { name: "TipoIdentificacion", label: "Tipo de Identificacion", dataType: "STRING", className: "Afiliaciones", property: "TipoIdentificacion" }
]);
assert.strictEqual(S.fillParameters(saved.cesql, params, { NroIdentificacion: "71'234", TipoIdentificacion: "CC" }),
  "SELECT d.[Id], d.[DocumentTitle] FROM [Afiliaciones] d WITH EXCLUDESUBCLASSES WHERE d.[NroIdentificacion] = '71''234'" +
  " AND d.[TipoIdentificacion] = 'CC' AND d.[Alcance] = 'A' AND d.[LineaProducto] = 'V' AND d.[VersionStatus] = 1");
assert.throws(() => S.fillParameters(saved.cesql, params, { NroIdentificacion: " ", TipoIdentificacion: "CC" }), /Falta el valor de #NroIdentificacion/);
// 18. Consulta creada fuera del plug-in (config no es una definición): los #Nombre del CE SQL; un nombre que es prefijo
// de otro no lo pisa; fuera de comillas, número; en LIKE y con tipo (fecha) desde la definición
const external = { cesql: "SELECT Id FROM Doc WHERE Nro = '#Nro' AND NroLargo LIKE '%#NroLargo%' AND Anio = #Anio", config: "{ vnRoot: \"A\" }" };
const extParams = S.getQueryParameters(external);
assert.deepStrictEqual(extParams.map(x => [x.name, x.dataType]), [["Nro", "STRING"], ["NroLargo", "STRING"], ["Anio", null]]);
assert.strictEqual(S.fillParameters(external.cesql, extParams, { Nro: "1", NroLargo: "2", Anio: "2026" }),
  "SELECT Id FROM Doc WHERE Nro = '1' AND NroLargo LIKE '%2%' AND Anio = 2026");
assert.throws(() => S.fillParameters(external.cesql, extParams, { Nro: "1", NroLargo: "2", Anio: "1 OR 1=1" }), /debe ser un número/);
assert.strictEqual(S.fillParameters("WHERE d.[F] >= #Desde", [{ name: "Desde", dataType: "DATETIME" }], { Desde: "2026-03-15T00:00:00.000-05:00" }),
  "WHERE d.[F] >= 20260315T050000Z");
// 19. Orden de los comodines: getParameters/getQueryParameters por parameterOrder (sin orden, al final en el orden
// de las condiciones); se conserva al reabrir; un orden no entero es un error
st = base();
st.criteria = [c("A", "xs:string", "EQUAL", ["a"]), c("B", "xs:string", "EQUAL", ["b"]), c("C", "xs:string", "EQUAL", ["c"]), c("D", "xs:string", "EQUAL", ["d"])];
st.parameters = { "A#1": { name: "A" }, "B#1": { name: "B", order: 2 }, "C#1": { name: "C", order: 1 }, "D#1": { name: "D" } };
r = S.build(st);
assert.deepStrictEqual(r.errors, []);
assert.strictEqual(r.definition.criteria[1].parameterOrder, 2);
assert.ok(!("parameterOrder" in r.definition.criteria[0]));
assert.deepStrictEqual(S.getParameters(r.definition).map(p => p.name), ["C", "B", "A", "D"]);
assert.deepStrictEqual(S.getQueryParameters({ cesql: S.toCeSql(r.definition), config: JSON.stringify(r.definition) }).map(p => [p.name, p.order]),
  [["C", 1], ["B", 2], ["A", undefined], ["D", undefined]]);
assert.deepStrictEqual(S.getWildcards(r.definition), st.parameters);
assert.deepStrictEqual(S.sortParameters([{ name: "x" }, { name: "y", order: 3 }, { name: "z" }, { name: "w", order: 1 }]).map(p => p.name), ["w", "y", "x", "z"]);
st.parameters = { "A#1": { name: "A", order: 1.5 } };
assert.ok(/debe ser un entero mayor que 0/.test(S.build(st).errors[0]));
console.log("OK: 20 casos (config del ejemplo: " + size + " caracteres)");
