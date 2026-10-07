define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dijit/form/Select",
	"dijit/form/SimpleTextarea",
	"ecm/widget/ValidationTextBox",
	"ecm/widget/dialog/BaseDialog",
	"dynamicQueriesDojo/DqApiClient",
	"dynamicQueriesDojo/QuerySerializer"
],
function(declare, lang, domClass, domConstruct, Select, SimpleTextarea, ValidationTextBox, BaseDialog, DqApiClient,
		QuerySerializer) {

	// Límites del servicio de consultas.
	var MAX_NAME = 100;
	var MAX_CESQL = 512;
	var MAX_CONFIG = 1024;

	/**
	 * @name dynamicQueriesDojo.SaveQueryDialog
	 * @class Guarda la consulta en el servicio de consultas (DqApiClient, /query) con el modelo
	 *        { name, cesql, config, status }: el usuario indica nombre y estado; cesql se genera de la definición
	 *        (QuerySerializer.toCeSql) y config es la definición como JSON, que permite volver a abrirla en el
	 *        constructor. Con query.id actualiza la consulta en lugar de crear otra.
	 * @augments ecm.widget.dialog.BaseDialog
	 */
	return declare("dynamicQueriesDojo.SaveQueryDialog", [ BaseDialog ], {
		/** @lends dynamicQueriesDojo.SaveQueryDialog.prototype */

		// { id, name, status, definition }: definition es obligatoria.
		query: null,

		// Errores de QuerySerializer; si hay, se muestran y no se permite guardar.
		definitionErrors: null,

		// Con fitContentArea (predeterminado) BaseDialog fija el alto del contenido al abrirse y recorta lo que se
		// agregue después, como el mensaje de error.
		fitContentArea: false,

		postCreate: function() {
			this.inherited(arguments);
			domClass.add(this.domNode, "dqSaveQueryDialog");
			this.setTitle(this.query.id ? "Guardar consulta" : "Guardar consulta nueva");

			var errors = (this.definitionErrors || []).slice();
			if (!errors.length) {
				try {
					this._cesql = QuerySerializer.toCeSql(this.query.definition);
				} catch (e) {
					errors.push("No se pudo generar el CE SQL: " + e.message);
				}
				this._config = JSON.stringify(this.query.definition);
				if (this._cesql && this._cesql.length > MAX_CESQL) {
					errors.push("El CE SQL generado tiene " + this._cesql.length + " caracteres y el servicio admite " +
						MAX_CESQL + ". Reduzca las condiciones o las columnas.");
				}
				if (this._config.length > MAX_CONFIG) {
					errors.push("La definición de la consulta tiene " + this._config.length + " caracteres y el servicio " +
						"admite " + MAX_CONFIG + ". Reduzca las condiciones o las columnas.");
				}
			}
			var invalid = errors.length > 0;
			this._saveButton = this.addButton("Guardar", lang.hitch(this, this._onSave), invalid, true);

			var table = domConstruct.create("table", { "class": "propertyTable", role: "presentation" }, this.contentArea);
			this._nameField = new ValidationTextBox({
				required: true,
				trim: true,
				propercase: false,
				maxLength: MAX_NAME,
				value: this.query.name || ""
			});
			this._addRow(table, "Nombre:", this._nameField, true);

			this._statusField = new Select({
				options: [ { label: "Activa", value: "ACTIVE" }, { label: "Inactiva", value: "INACTIVE" } ],
				value: this.query.status || "ACTIVE"
			});
			this._addRow(table, "Estado:", this._statusField, true);

			// Solo lectura: se genera de lo que el usuario definió en el constructor.
			this._cesqlField = new SimpleTextarea({ rows: 5, readOnly: true, value: this._cesql || "", "class": "dqCesql" });
			this._addRow(table, "CE SQL:", this._cesqlField);

			if (invalid) {
				this.setMessage("La consulta todavía no se puede guardar: " + errors.join(" "), "error");
			}
		},

		_addRow: function(table, label, widget, required) {
			var row = domConstruct.create("tr", null, table);
			var labelCell = domConstruct.create("td", { "class": "propertyRowLabel" }, row);
			if (required) {
				domConstruct.create("span", { "class": "required", textContent: "*" }, labelCell);
			}
			domConstruct.create("label", { "for": widget.id, textContent: label }, labelCell);
			widget.placeAt(domConstruct.create("td", { "class": "propertyRowValue" }, row));
			this.own(widget);
			return row;
		},

		_onSave: function() {
			if (!this._nameField.validate()) {
				this.setMessage("Complete los campos obligatorios.", "error");
				return;
			}
			this._saveButton.set("disabled", true);
			this.setMessage("", "info");

			var body = {
				name: this._nameField.get("value"),
				cesql: this._cesql,
				config: this._config,
				status: this._statusField.get("value")
			};
			(this.query.id ? DqApiClient.updateQuery(this.query.id, body) : DqApiClient.createQuery(body))
				.then(lang.hitch(this, function(savedQuery) {
					this.onSaved(savedQuery);
					this.hide();
				}), lang.hitch(this, function(error) {
					this.setMessage(error.message, "error");
					this._saveButton.set("disabled", false);
				}));
		},

		/**
		 * Se invoca con la consulta guardada tal como la devolvió el servicio ({ id, name, cesql, config, status, ... }).
		 */
		onSaved: function(savedQuery) {
		}
	});
});
