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
	 * @name dynamicQueriesDojo.NewProjectDialog
	 * @class "Nuevo proyecto": pide nombre y descripción y crea el proyecto en el servicio de proyectos
	 *        (QueryStoreService, operación createProject).
	 * @augments ecm.widget.dialog.BaseDialog
	 */
	return declare("dynamicQueriesDojo.NewProjectDialog", [ BaseDialog ], {
		/** @lends dynamicQueriesDojo.NewProjectDialog.prototype */

		// Como en SaveQueryDialog: sin esto BaseDialog recorta el contenido que se agregue después de abrirse.
		fitContentArea: false,

		postCreate: function() {
			this.inherited(arguments);
			domClass.add(this.domNode, "dqNewProjectDialog");
			this.setTitle("Nuevo proyecto");
			this._createButton = this.addButton("Crear", lang.hitch(this, this._onCreate), false, true);

			var table = domConstruct.create("table", { "class": "propertyTable", role: "presentation" }, this.contentArea);
			this._nameField = new ValidationTextBox({
				required: true,
				trim: true,
				propercase: false,
				maxLength: 200
			});
			this._addRow(table, "Nombre:", this._nameField, true);

			this._descriptionField = new SimpleTextarea({ rows: 3, maxLength: 1000 });
			this._addRow(table, "Descripción:", this._descriptionField);
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

		_onCreate: function() {
			if (!this._nameField.validate()) {
				this.setMessage("Complete los campos obligatorios.", "error");
				return;
			}
			this._createButton.set("disabled", true);
			this.setMessage("", "info");

			var name = this._nameField.get("value");
			var description = this._descriptionField.get("value");
			QueryStoreClient.createProject({ name: name, description: description }).then(lang.hitch(this, function(response) {
				this.onCreated({ name: name, description: description, response: response });
				this.hide();
			}), lang.hitch(this, function(error) {
				this.setMessage(error.message, "error");
				this._createButton.set("disabled", false);
			}));
		},

		/**
		 * Se invoca cuando el servicio creó el proyecto, con { name, description, response }; response es lo que
		 * devolvió el servicio (null si no trae cuerpo).
		 */
		onCreated: function(project) {
		}
	});
});
