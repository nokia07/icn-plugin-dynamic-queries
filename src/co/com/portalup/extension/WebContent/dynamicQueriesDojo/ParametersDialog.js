define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dijit/form/CheckBox",
	"dijit/form/NumberTextBox",
	"ecm/widget/ValidationTextBox",
	"ecm/widget/dialog/BaseDialog",
	"dynamicQueriesDojo/QuerySerializer"
],
function(declare, lang, array, domClass, domConstruct, CheckBox, NumberTextBox, ValidationTextBox, BaseDialog, QuerySerializer) {

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
	 *        nombre (#Nombre en el CE SQL, ver QuerySerializer), y en qué orden aparecen sus campos en "Resultados de
	 *        consultas". Las condiciones conservan su valor de ejemplo, que es el que usa Buscar en el diseñador. Solo se
	 *        listan las condiciones con valor.
	 * @augments ecm.widget.dialog.BaseDialog
	 */
	return declare("dynamicQueriesDojo.ParametersDialog", [ BaseDialog ], {
		/** @lends dynamicQueriesDojo.ParametersDialog.prototype */

		// Definición actual de la consulta (QuerySerializer.serialize).
		definition: null,

		// Comodines actuales: { clave: { name, order } } (claves de QuerySerializer.getConditions).
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
					"el valor se reemplaza por #Nombre; el valor actual queda como ejemplo para probar con Buscar. Orden es la " +
					"posición del campo al ejecutar la consulta en Resultados de consultas (1 es el primero)."
			}, this.contentArea);
			if (!conditions.length) {
				this.setMessage("Defina primero en los filtros las condiciones con un valor de ejemplo.", "info");
				return;
			}

			var table = domConstruct.create("table", { "class": "dqParametersTable" }, this.contentArea);
			var header = domConstruct.create("tr", null, domConstruct.create("thead", null, table));
			array.forEach([ "Comodín", "Condición", "Nombre", "Orden" ], function(title) {
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
			var checked = allowed && !!current;
			var row = domConstruct.create("tr", null, body);

			var checkBox = new CheckBox({ checked: checked, disabled: !allowed });
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
				value: current ? current.name : suggestedName(condition.property),
				disabled: !checkBox.get("checked"),
				required: true,
				trim: true,
				propercase: false,
				maxLength: 64,
				regExp: PARAMETER_NAME.source.replace(/^\^|\$$/g, ""),
				invalidMessage: "Empiece por una letra y use solo letras, números o _."
			});
			nameField.placeAt(domConstruct.create("td", null, row));

			// Sin orden guardado (consultas anteriores a esta opción), el siguiente a los ya marcados.
			var orderField = new NumberTextBox({
				"class": "dqParametersOrder",
				value: !checked ? NaN : current.order !== undefined ? current.order : this._nextOrder(),
				disabled: !checked,
				required: true,
				constraints: { min: 1, max: 999, places: 0 },
				invalidMessage: "Use un entero mayor que 0.",
				rangeMessage: "Use un entero entre 1 y 999."
			});
			orderField.placeAt(domConstruct.create("td", null, row));

			this.own(nameField, orderField, checkBox.on("change", lang.hitch(this, function(isChecked) {
				nameField.set("disabled", !isChecked);
				orderField.set("disabled", !isChecked);
				if (isChecked && isNaN(orderField.get("value"))) {
					orderField.set("value", this._nextOrder());
				}
			})));

			this._rows.push({ key: entry.key, checkBox: checkBox, nameField: nameField, orderField: orderField });
		},

		// Orden propuesto para un comodín recién marcado: uno más que el mayor de los marcados.
		_nextOrder: function() {
			var max = 0;
			array.forEach(this._rows, function(row) {
				var order = row.orderField.get("value");
				if (row.checkBox.get("checked") && order > max) {
					max = order;
				}
			});
			return max + 1;
		},

		_onApply: function() {
			var parameters = {};
			var used = {};
			var usedOrders = {};
			var error = null;
			array.forEach(this._rows, function(row) {
				if (error || !row.checkBox.get("checked")) {
					return;
				}
				var name = row.nameField.get("value");
				var order = row.orderField.get("value");
				if (!PARAMETER_NAME.test(name)) {
					error = "El nombre “" + name + "” no es válido: empiece por una letra y use solo letras, números o _.";
				} else if (used[name]) {
					error = "El comodín #" + name + " está repetido; use nombres distintos.";
				} else if (!row.orderField.isValid() || !(order >= 1)) {
					error = "El orden de #" + name + " debe ser un entero entre 1 y 999.";
				} else if (usedOrders[order]) {
					error = "El orden " + order + " está en #" + usedOrders[order] + " y en #" + name + "; use órdenes distintos.";
				}
				used[name] = true;
				usedOrders[order] = name;
				parameters[row.key] = { name: name, order: order };
			});
			if (error) {
				this.setMessage(error, "error");
				return;
			}
			this.onApply(parameters);
			this.hide();
		},

		/**
		 * Se invoca con los comodines elegidos: { clave: { name, order } }.
		 */
		onApply: function(parameters) {
		}
	});
});
