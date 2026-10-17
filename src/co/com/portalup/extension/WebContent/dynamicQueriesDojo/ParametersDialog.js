define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dijit/form/CheckBox",
	"ecm/widget/ValidationTextBox",
	"ecm/widget/dialog/BaseDialog",
	"dynamicQueriesDojo/QuerySerializer"
],
function(declare, lang, array, domClass, domConstruct, CheckBox, ValidationTextBox, BaseDialog, QuerySerializer) {

	var OPERATOR_LABELS = {
		EQUAL: "igual a",
		NOT_EQUAL: "distinto de",
		LESS: "menor que",
		LESS_OR_EQUAL: "menor o igual que",
		GREATER: "mayor que",
		GREATER_OR_EQUAL: "mayor o igual que",
		STARTS_WITH: "empieza por",
		ENDS_WITH: "termina en",
		CONTAINS: "contiene",
		NOT_CONTAINS: "no contiene",
		BETWEEN: "entre",
		NOT_BETWEEN: "no entre",
		IN: "en",
		NOT_IN: "no en",
		IS_NULL: "vacío",
		IS_NOT_NULL: "no vacío"
	};

	var PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

	// Nombre propuesto para un comodín: el nombre simbólico de la propiedad, solo con caracteres válidos.
	function suggestedName(property) {
		var name = String(property).replace(/[^A-Za-z0-9_]/g, "");
		return /^[A-Za-z]/.test(name) ? name : "P" + name;
	}

	/**
	 * @name dynamicQueriesDojo.ParametersDialog
	 * @class "Comodines": marca qué condiciones de los filtros se piden al ejecutar la consulta guardada y con qué
	 *        nombre (#Nombre en el CE SQL, ver QuerySerializer). Las condiciones conservan su valor de ejemplo, que es
	 *        el que usa Buscar en el diseñador. Solo se listan las condiciones con valor.
	 * @augments ecm.widget.dialog.BaseDialog
	 */
	return declare("dynamicQueriesDojo.ParametersDialog", [ BaseDialog ], {
		/** @lends dynamicQueriesDojo.ParametersDialog.prototype */

		// Definición actual de la consulta (QuerySerializer.serialize).
		definition: null,

		// Comodines actuales: { clave: nombre } (claves de QuerySerializer.getConditions).
		parameters: null,

		fitContentArea: false,

		postCreate: function() {
			this.inherited(arguments);
			domClass.add(this.domNode, "dqParametersDialog");
			this.setTitle("Comodines");
			this._rows = [];

			var conditions = QuerySerializer.getConditions(this.definition);
			this._applyButton = this.addButton("Aplicar", lang.hitch(this, this._onApply), !conditions.length, true);
			domConstruct.create("p", {
				"class": "dqParametersIntro",
				textContent: "Marque las condiciones cuyo valor se pedirá al ejecutar la consulta guardada. En el CE SQL " +
					"el valor se reemplaza por #Nombre; el valor actual queda como ejemplo para probar con Buscar."
			}, this.contentArea);
			if (!conditions.length) {
				this.setMessage("Defina primero en los filtros las condiciones con un valor de ejemplo.", "info");
				return;
			}

			var table = domConstruct.create("table", { "class": "dqParametersTable" }, this.contentArea);
			var header = domConstruct.create("tr", null, domConstruct.create("thead", null, table));
			array.forEach([ "Comodín", "Condición", "Nombre" ], function(title) {
				domConstruct.create("th", { textContent: title }, header);
			});
			var body = domConstruct.create("tbody", null, table);
			array.forEach(conditions, function(entry) {
				this._addRow(body, entry);
			}, this);
		},

		_addRow: function(body, entry) {
			var condition = entry.condition;
			var allowed = QuerySerializer.canBeParameter(condition);
			var current = (this.parameters || {})[entry.key];
			var row = domConstruct.create("tr", null, body);

			var checkBox = new CheckBox({ checked: allowed && !!current, disabled: !allowed });
			checkBox.placeAt(domConstruct.create("td", null, row));
			this.own(checkBox);

			var conditionCell = domConstruct.create("td", null, row);
			domConstruct.create("label", {
				"for": checkBox.id,
				textContent: (condition.label || condition.property) + " " + (OPERATOR_LABELS[condition.operator] || condition.operator) +
					(condition.values.length ? " " + condition.values.join(", ") : "")
			}, conditionCell);
			if (!allowed) {
				domConstruct.create("div", {
					"class": "dqParametersNote",
					textContent: "No admite comodín: use un operador de un solo valor."
				}, conditionCell);
			}

			var nameField = new ValidationTextBox({
				value: current || suggestedName(condition.property),
				disabled: !checkBox.get("checked"),
				required: true,
				trim: true,
				propercase: false,
				maxLength: 64,
				regExp: PARAMETER_NAME.source.replace(/^\^|\$$/g, ""),
				invalidMessage: "Empiece por una letra y use solo letras, números o _."
			});
			nameField.placeAt(domConstruct.create("td", null, row));
			this.own(nameField, checkBox.on("change", function(checked) {
				nameField.set("disabled", !checked);
			}));

			this._rows.push({ key: entry.key, checkBox: checkBox, nameField: nameField });
		},

		_onApply: function() {
			var parameters = {};
			var used = {};
			var error = null;
			array.forEach(this._rows, function(row) {
				if (error || !row.checkBox.get("checked")) {
					return;
				}
				var name = row.nameField.get("value");
				if (!PARAMETER_NAME.test(name)) {
					error = "El nombre “" + name + "” no es válido: empiece por una letra y use solo letras, números o _.";
				} else if (used[name]) {
					error = "El comodín #" + name + " está repetido; use nombres distintos.";
				}
				used[name] = true;
				parameters[row.key] = name;
			});
			if (error) {
				this.setMessage(error, "error");
				return;
			}
			this.onApply(parameters);
			this.hide();
		},

		/**
		 * Se invoca con los comodines elegidos: { clave: nombre }.
		 */
		onApply: function(parameters) {
		}
	});
});
