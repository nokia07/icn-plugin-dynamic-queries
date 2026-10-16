define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/on",
	"dijit/form/Button",
	"dijit/form/Select",
	"ecm/widget/ValidationTextBox",
	"ecm/widget/dialog/BaseDialog",
	"ecm/widget/dialog/ConfirmationDialog",
	"dynamicQueriesDojo/DqApiClient"
],
function(declare, lang, array, domClass, domConstruct, on, Button, Select, ValidationTextBox, BaseDialog,
		ConfirmationDialog, DqApiClient) {

	var STATUS_LABELS = { ACTIVE: "Activo", INACTIVE: "Inactivo" };

	// Límite del servicio de proyectos para nombre y descripción.
	var MAX_TEXT = 100;

	/**
	 * @name dynamicQueriesDojo.ProjectsDialog
	 * @class "Proyectos": lista los proyectos del servicio de proyectos (filtrables por estado) y permite crearlos,
	 *        editarlos y eliminarlos. Llama al servicio desde el navegador con DqApiClient.
	 * @augments ecm.widget.dialog.BaseDialog
	 */
	return declare("dynamicQueriesDojo.ProjectsDialog", [ BaseDialog ], {
		/** @lends dynamicQueriesDojo.ProjectsDialog.prototype */

		// Como en SaveQueryDialog: sin esto BaseDialog recorta el contenido que se agregue después de abrirse (el
		// formulario y los mensajes).
		fitContentArea: false,

		cancelButtonLabel: "Cerrar",

		// Proyectos de la lista actual y el seleccionado.
		_projects: null,
		_selected: null,

		// Proyecto que se está editando en el formulario; null al crear.
		_editing: null,

		postCreate: function() {
			this.inherited(arguments);
			domClass.add(this.domNode, "dqProjectsDialog");
			this.setTitle("Proyectos");

			var content = domConstruct.create("div", { "class": "dqProjectsContent" }, this.contentArea);
			this._buildToolbar(content);
			// El formulario va entre la barra y la lista, para que quede a la vista al crear o editar.
			this._buildForm(content);
			this._buildTable(content);
			this._projects = [];
			this.loadProjects();
		},

		_buildToolbar: function(parent) {
			var toolbar = domConstruct.create("div", { "class": "dqProjectsToolbar" }, parent);
			this._newButton = this._addToolbarButton(toolbar, "Nuevo", this._onNew);
			this._editButton = this._addToolbarButton(toolbar, "Editar", this._onEdit, true);
			this._deleteButton = this._addToolbarButton(toolbar, "Eliminar", this._onDelete, true);
			this._addToolbarButton(toolbar, "Actualizar", this.loadProjects);

			var filter = domConstruct.create("div", { "class": "dqProjectsFilter" }, toolbar);
			this._statusFilter = new Select({
				options: [
					{ label: "Todos", value: "" },
					{ label: "Activos", value: "ACTIVE" },
					{ label: "Inactivos", value: "INACTIVE" }
				]
			});
			domConstruct.create("label", { "for": this._statusFilter.id, textContent: "Estado:" }, filter);
			this._statusFilter.placeAt(filter);
			this.own(this._statusFilter, this._statusFilter.on("change", lang.hitch(this, this.loadProjects)));
		},

		_addToolbarButton: function(toolbar, label, handler, disabled) {
			var button = new Button({ label: label, disabled: !!disabled, onClick: lang.hitch(this, handler) });
			button.placeAt(toolbar);
			this.own(button);
			return button;
		},

		_buildTable: function(parent) {
			var wrapper = domConstruct.create("div", { "class": "dqProjectsGrid" }, parent);
			var table = domConstruct.create("table", { role: "grid" }, wrapper);
			var headRow = domConstruct.create("tr", null, domConstruct.create("thead", null, table));
			array.forEach([ "Id", "Nombre", "Descripción", "Estado", "Creado" ], function(label) {
				domConstruct.create("th", { textContent: label }, headRow);
			});
			this._tableBody = domConstruct.create("tbody", null, table);
			this._emptyNode = domConstruct.create("div", { "class": "dqProjectsEmpty" }, wrapper);

			// En el cuerpo y no en cada fila: las filas se vuelven a crear en cada carga.
			this.own(on(this._tableBody, "click", lang.hitch(this, function(evt) {
				this._select(this._projectForRow(evt.target));
			})));
			this.own(on(this._tableBody, "dblclick", lang.hitch(this, function(evt) {
				if (this._projectForRow(evt.target)) {
					this._select(this._projectForRow(evt.target));
					this._onEdit();
				}
			})));
		},

		_buildForm: function(parent) {
			this._formNode = domConstruct.create("fieldset", { "class": "dqProjectsForm dijitHidden" }, parent);
			this._formTitle = domConstruct.create("legend", null, this._formNode);
			var table = domConstruct.create("table", { "class": "propertyTable", role: "presentation" }, this._formNode);

			this._nameField = new ValidationTextBox({ required: true, trim: true, propercase: false, maxLength: MAX_TEXT });
			this._addRow(table, "Nombre:", this._nameField, true);
			this._descriptionField = new ValidationTextBox({ required: true, trim: true, propercase: false, maxLength: MAX_TEXT });
			this._addRow(table, "Descripción:", this._descriptionField, true);
			this._statusField = new Select({
				options: [ { label: STATUS_LABELS.ACTIVE, value: "ACTIVE" }, { label: STATUS_LABELS.INACTIVE, value: "INACTIVE" } ]
			});
			this._addRow(table, "Estado:", this._statusField, true);

			var actions = domConstruct.create("div", { "class": "dqProjectsFormActions" }, this._formNode);
			this._saveButton = this._addToolbarButton(actions, "Guardar", this._onSave);
			this._addToolbarButton(actions, "Cancelar", this._hideForm);
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

		/**
		 * Vuelve a consultar los proyectos con el filtro de estado actual. selectId: proyecto a seleccionar después (si
		 * no se indica, se conserva la selección actual si sigue en la lista).
		 */
		loadProjects: function(selectId) {
			if (typeof selectId !== "number") {
				selectId = this._selected ? this._selected.id : null;
			}
			this._setEmptyText("Cargando proyectos…");
			DqApiClient.listProjects(this._statusFilter.get("value")).then(lang.hitch(this, function(projects) {
				this._projects = projects instanceof Array ? projects : [];
				this._renderRows();
				this._select(array.filter(this._projects, function(project) { return project.id === selectId; })[0]);
			}), lang.hitch(this, function(error) {
				this._projects = [];
				this._renderRows();
				this._select(null);
				this._setEmptyText("No se pudieron cargar los proyectos.");
				this.setMessage(error.message, "error");
			}));
		},

		_renderRows: function() {
			domConstruct.empty(this._tableBody);
			array.forEach(this._projects, function(project, index) {
				var row = domConstruct.create("tr", { "data-index": index }, this._tableBody);
				array.forEach([
					project.id,
					project.name,
					project.description,
					STATUS_LABELS[project.status] || project.status,
					formatDate(project.createdAt)
				], function(value) {
					domConstruct.create("td", { textContent: value == null ? "" : String(value) }, row);
				});
			}, this);
			this._setEmptyText(this._projects.length ? "" : "No hay proyectos registrados.");
		},

		_setEmptyText: function(text) {
			this._emptyNode.textContent = text;
			domClass.toggle(this._emptyNode, "dijitHidden", !text);
		},

		_projectForRow: function(node) {
			while (node && node !== this._tableBody && node.tagName !== "TR") {
				node = node.parentNode;
			}
			return node && node.tagName === "TR" ? this._projects[Number(node.getAttribute("data-index"))] : null;
		},

		_select: function(project) {
			this._selected = project || null;
			array.forEach(this._tableBody.rows, function(row) {
				domClass.toggle(row, "dqSelected", this._projects[Number(row.getAttribute("data-index"))] === this._selected);
			}, this);
			this._editButton.set("disabled", !this._selected);
			this._deleteButton.set("disabled", !this._selected);
		},

		_onNew: function() {
			this._showForm(null);
		},

		_onEdit: function() {
			if (this._selected) {
				this._showForm(this._selected);
			}
		},

		_showForm: function(project) {
			this._editing = project;
			this._formTitle.textContent = project ? "Editar proyecto " + project.id : "Nuevo proyecto";
			this._nameField.set("value", project ? project.name : "");
			this._descriptionField.set("value", project ? project.description || "" : "");
			this._statusField.set("value", project ? project.status : "ACTIVE");
			// Sin marcar los campos vacíos de un proyecto nuevo como inválidos antes de que el usuario escriba.
			this._nameField.set("state", "");
			this._descriptionField.set("state", "");
			this._saveButton.set("disabled", false);
			this.setMessage("", "info");
			domClass.remove(this._formNode, "dijitHidden");
			this._nameField.focus();
		},

		_hideForm: function() {
			this._editing = null;
			domClass.add(this._formNode, "dijitHidden");
		},

		_onSave: function() {
			var nameValid = this._nameField.validate();
			var descriptionValid = this._descriptionField.validate();
			if (!nameValid || !descriptionValid) {
				this.setMessage("Complete los campos obligatorios.", "error");
				return;
			}
			var project = {
				name: this._nameField.get("value"),
				description: this._descriptionField.get("value"),
				status: this._statusField.get("value")
			};
			var editing = this._editing;
			this._saveButton.set("disabled", true);
			this.setMessage("", "info");
			(editing ? DqApiClient.updateProject(editing.id, project) : DqApiClient.createProject(project))
				.then(lang.hitch(this, function(saved) {
					this._hideForm();
					this.setMessage(editing ? "Proyecto actualizado." : "Proyecto creado.", "info");
					this.loadProjects(saved && typeof saved.id === "number" ? saved.id : undefined);
				}), lang.hitch(this, function(error) {
					this.setMessage(error.message, "error");
					this._saveButton.set("disabled", false);
					if (error.status === 404) {
						// Otro usuario lo eliminó mientras se editaba.
						this._hideForm();
						this.loadProjects();
					}
				}));
		},

		_onDelete: function() {
			var project = this._selected;
			if (!project) {
				return;
			}
			var dialog = new ConfirmationDialog({
				text: "¿Eliminar el proyecto “" + project.name + "”? Esta acción no se puede deshacer.",
				buttonLabel: "Eliminar",
				cancelButtonDefault: true,
				onExecute: lang.hitch(this, function() {
					DqApiClient.deleteProject(project.id).then(lang.hitch(this, function() {
						if (this._editing && this._editing.id === project.id) {
							this._hideForm();
						}
						this._select(null);
						this.setMessage("Proyecto eliminado.", "info");
						this.loadProjects();
					}), lang.hitch(this, function(error) {
						this.setMessage(error.message, "error");
						if (error.status === 404) {
							this.loadProjects();
						}
					}));
				})
			});
			dialog.show();
		}
	});

	/** "2026-10-06T10:15:30.123" → "2026-10-06 10:15". */
	function formatDate(value) {
		var match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value || "");
		return match ? match[1] + " " + match[2] : value || "";
	}
});
