define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/when",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dijit/form/Select",
	"dijit/form/SimpleTextarea",
	"ecm/widget/ValidationTextBox",
	"ecm/widget/dialog/BaseDialog",
	"dynamicQueriesDojo/QueryStoreClient"
],
function(declare, lang, array, when, domClass, domConstruct, Select, SimpleTextarea, ValidationTextBox, BaseDialog,
		QueryStoreClient) {

	var NEW_CATEGORY = "__new__";

	/**
	 * @name dynamicQueriesDojo.SaveQueryDialog
	 * @class Pide nombre, descripción y categoría (existente o nueva) y guarda la consulta en el servicio de
	 *        consultas. Con query.id actualiza la consulta en lugar de crear otra.
	 * @augments ecm.widget.dialog.BaseDialog
	 */
	return declare("dynamicQueriesDojo.SaveQueryDialog", [ BaseDialog ], {
		/** @lends dynamicQueriesDojo.SaveQueryDialog.prototype */

		// { id, version, name, description, categoryId, definition }: definition es obligatoria.
		query: null,

		// Errores de QuerySerializer; si hay, se muestran y no se permite guardar.
		definitionErrors: null,

		// Con fitContentArea (predeterminado) BaseDialog fija el alto del contenido al abrirse y recorta lo demás.
		fitContentArea: false,

		postCreate: function() {
			this.inherited(arguments);
			domClass.add(this.domNode, "dqSaveQueryDialog");
			this.setTitle(this.query.id ? "Guardar consulta" : "Guardar consulta nueva");
			this._saveButton = this.addButton("Guardar", lang.hitch(this, this._onSave), true, true);

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

			this._categorySelect = new Select({ options: [], disabled: true });
			this._addRow(table, "Categoría:", this._categorySelect, true);
			this.own(this._categorySelect.on("change", lang.hitch(this, this._updateNewCategoryField)));

			// Siempre visible (solo se habilita): BaseDialog calcula su alto al abrirse y no lo recalcula.
			this._newCategoryField = new ValidationTextBox({
				required: true,
				trim: true,
				propercase: false,
				maxLength: 120,
				disabled: true
			});
			this._addRow(table, "Nueva categoría:", this._newCategoryField);

			if (this.definitionErrors && this.definitionErrors.length) {
				this.setMessage("La consulta todavía no es válida: " + this.definitionErrors.join(" "), "error");
			}
		},

		/**
		 * Carga las categorías y luego abre el diálogo: BaseDialog ajusta su alto al contenido solo al abrirse.
		 */
		show: function() {
			var show = lang.hitch(this, BaseDialog.prototype.show);
			this._loadCategories().then(show, show);
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

		_loadCategories: function() {
			return QueryStoreClient.listCategories().then(lang.hitch(this, function(categories) {
				var options = array.map(categories, function(category) {
					return { label: category.name, value: category.id };
				});
				options.push({ label: "Nueva categoría…", value: NEW_CATEGORY });
				this._categorySelect.set("options", options);
				this._categorySelect.set("value", this._createdCategoryId || this.query.categoryId || options[0].value);
				this._categorySelect.set("disabled", false);
				this._updateNewCategoryField();
				if (QueryStoreClient.mode === "memory" && !this._memoryNote) {
					// En el contenido y no con setIntroText: BaseDialog mide la introducción antes de que el texto
					// haga salto de línea y el diálogo queda más bajo que su contenido.
					this._memoryNote = domConstruct.create("p", {
						"class": "dqSaveNote",
						textContent: "Modo simulado: el servicio de consultas no está configurado. Las consultas se " +
							"guardan en la memoria del servidor de ICN y se pierden al reiniciarlo."
					}, this.contentArea, "first");
				}
				this._saveButton.set("disabled", !!(this.definitionErrors && this.definitionErrors.length));
			}), lang.hitch(this, this._showError));
		},

		_updateNewCategoryField: function() {
			this._newCategoryField.set("disabled", this._categorySelect.get("value") !== NEW_CATEGORY);
		},

		_onSave: function() {
			var isNewCategory = this._categorySelect.get("value") === NEW_CATEGORY;
			if (!this._nameField.validate() || (isNewCategory && !this._newCategoryField.validate())) {
				this.setMessage("Complete los campos obligatorios.", "error");
				return;
			}
			this._saveButton.set("disabled", true);
			this.setMessage("", "info");

			var categoryId = isNewCategory ? QueryStoreClient.createCategory({
				name: this._newCategoryField.get("value")
			}).then(lang.hitch(this, function(category) {
				this._createdCategoryId = category.id;
				return category.id;
			})) : this._categorySelect.get("value");

			var query = this.query;
			var saved = when(categoryId).then(lang.hitch(this, function(id) {
				return QueryStoreClient.saveQuery({
					id: query.id,
					version: query.version,
					name: this._nameField.get("value"),
					description: this._descriptionField.get("value"),
					categoryId: id,
					definition: query.definition
				});
			}));
			saved.then(lang.hitch(this, function(savedQuery) {
				this.onSaved(savedQuery);
				this.hide();
			}), lang.hitch(this, function(error) {
				this._showError(error);
				this._saveButton.set("disabled", false);
				if (this._createdCategoryId) {
					// La categoría se creó aunque falló la consulta: recargar y dejarla seleccionada para no duplicarla.
					this._loadCategories();
				}
			}));
		},

		_showError: function(error) {
			this.setMessage(error.message, "error");
		},

		/**
		 * Se invoca con la consulta guardada tal como la devolvió el servicio (incluye id y version).
		 */
		onSaved: function(savedQuery) {
		}
	});
});
