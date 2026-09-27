define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dijit/form/SimpleTextarea",
	"ecm/widget/ValidationTextBox",
	"ecm/widget/dialog/BaseDialog",
	"dynamicQueriesDojo/QueryStoreClient"
],
function(declare, lang, domClass, domConstruct, SimpleTextarea, ValidationTextBox, BaseDialog, QueryStoreClient) {

	/**
	 * @name dynamicQueriesDojo.SaveQueryDialog
	 * @class Pide nombre y descripción y guarda la consulta en el servicio de consultas. Con query.id actualiza la
	 *        consulta en lugar de crear otra.
	 * @augments ecm.widget.dialog.BaseDialog
	 */
	return declare("dynamicQueriesDojo.SaveQueryDialog", [ BaseDialog ], {
		/** @lends dynamicQueriesDojo.SaveQueryDialog.prototype */

		// { id, version, name, description, definition }: definition es obligatoria.
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
			var invalid = !!(this.definitionErrors && this.definitionErrors.length);
			this._saveButton = this.addButton("Guardar", lang.hitch(this, this._onSave), invalid, true);

			if (QueryStoreClient.mode === "memory") {
				// En el contenido y no con setIntroText: BaseDialog mide la introducción antes de que el texto haga
				// salto de línea y el diálogo queda más bajo que su contenido.
				domConstruct.create("p", {
					"class": "dqSaveNote",
					textContent: "Modo simulado: el servicio de consultas no está configurado. Las consultas se " +
						"guardan en la memoria del servidor de ICN y se pierden al reiniciarlo."
				}, this.contentArea);
			}

			var table = domConstruct.create("table", { "class": "propertyTable", role: "presentation" }, this.contentArea);
			this._nameField = new ValidationTextBox({
				required: true,
				trim: true,
				propercase: false,
				maxLength: 200,
				value: this.query.name || ""
			});
			this._addRow(table, "Nombre:", this._nameField, true);

			this._descriptionField = new SimpleTextarea({ rows: 3, maxLength: 1000, value: this.query.description || "" });
			this._addRow(table, "Descripción:", this._descriptionField);

			if (invalid) {
				this.setMessage("La consulta todavía no es válida: " + this.definitionErrors.join(" "), "error");
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

			QueryStoreClient.saveQuery({
				id: this.query.id,
				version: this.query.version,
				name: this._nameField.get("value"),
				description: this._descriptionField.get("value"),
				definition: this.query.definition
			}).then(lang.hitch(this, function(savedQuery) {
				this.onSaved(savedQuery);
				this.hide();
			}), lang.hitch(this, function(error) {
				this.setMessage(error.message, "error");
				this._saveButton.set("disabled", false);
			}));
		},

		/**
		 * Se invoca con la consulta guardada tal como la devolvió el servicio (incluye id y version).
		 */
		onSaved: function(savedQuery) {
		}
	});
});
