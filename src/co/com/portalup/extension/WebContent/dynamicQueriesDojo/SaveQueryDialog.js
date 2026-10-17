define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/when",
	"dijit/form/Select",
	"dijit/form/SimpleTextarea",
	"ecm/widget/ValidationTextBox",
	"ecm/widget/dialog/BaseDialog",
	"dynamicQueriesDojo/DqApiClient",
	"dynamicQueriesDojo/QuerySerializer"
],
function(declare, lang, array, domClass, domConstruct, when, Select, SimpleTextarea, ValidationTextBox, BaseDialog, DqApiClient,
		QuerySerializer) {

	// Límites del servicio de consultas y de asociaciones: config de la consulta (la definición) es un CLOB sin límite;
	// el de la asociación (ruta de agrupación) sigue siendo de 1024.
	var MAX_NAME = 100;
	var MAX_CESQL = 4000;
	var MAX_GROUPING_CONFIG = 1024;

	/**
	 * @name dynamicQueriesDojo.SaveQueryDialog
	 * @class Guarda la consulta en el servicio de consultas (DqApiClient, /query) con el modelo
	 *        { name, cesql, config, status } (cesql hasta 4000 caracteres; config sin límite) y la asocia a un proyecto (/project-query) con la ruta de agrupación de
	 *        los resultados como config de la asociación, en el formato de DSCONFIG de la consulta general
	 *        ({ vnRoot: "Carpeta,Subcarpeta" }, QuerySerializer.toGroupingConfig). El usuario indica nombre, proyecto,
	 *        ruta y estado; cesql (con los comodines como #Nombre) se genera de la
	 *        definición (QuerySerializer.toCeSql) y config es la definición como JSON, que permite volver a abrirla en
	 *        el constructor. Con query.id actualiza la consulta (y su asociación) en lugar de crear otra.
	 *
	 *        Primero se guarda la consulta y, con su id, la asociación. Si la asociación falla al crear una consulta
	 *        nueva, se elimina la consulta recién creada para no dejarla sin proyecto.
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

		// Asociación proyecto-consulta existente ({ id, projectId, config, ... }) al editar una consulta guardada.
		_association: null,

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
						MAX_CESQL + ". Reduzca las condiciones.");
				}
			}
			this._invalid = errors.length > 0;
			// Deshabilitado hasta cargar los proyectos (y la asociación, al editar).
			this._saveButton = this.addButton("Guardar", lang.hitch(this, this._onSave), true, true);

			var table = domConstruct.create("table", { "class": "propertyTable", role: "presentation" }, this.contentArea);
			this._nameField = new ValidationTextBox({
				required: true,
				trim: true,
				propercase: false,
				maxLength: MAX_NAME,
				value: this.query.name || ""
			});
			this._addRow(table, "Nombre:", this._nameField, true);

			this._projectField = new Select({
				options: [ { label: "Cargando proyectos…", value: "" } ],
				disabled: true,
				"class": "dqProjectSelect"
			});
			this._addRow(table, "Proyecto:", this._projectField, true);

			// Carpetas en las que se agrupan los resultados, separadas por comas; sin comillas porque van dentro de vnRoot.
			this._pathField = new ValidationTextBox({
				required: true,
				trim: true,
				propercase: false,
				maxLength: MAX_GROUPING_CONFIG - 20,
				regExp: '[^"]*[^",\\s][^"]*',
				invalidMessage: "Escriba las carpetas separadas por comas, sin comillas.",
				placeHolder: "Expediente Afiliado,Pensión Voluntaria,Afiliaciones"
			});
			this._addRow(table, "Ruta de agrupación:", this._pathField, true);

			this._statusField = new Select({
				options: [ { label: "Activa", value: "ACTIVE" }, { label: "Inactiva", value: "INACTIVE" } ],
				value: this.query.status || "ACTIVE"
			});
			this._addRow(table, "Estado:", this._statusField, true);

			// Solo lectura: se genera de lo que el usuario definió en el constructor.
			this._cesqlField = new SimpleTextarea({ rows: 5, readOnly: true, value: this._cesql || "", "class": "dqCesql" });
			this._addRow(table, "CE SQL:", this._cesqlField);

			var parameters = QuerySerializer.getParameters(this.query.definition);
			if (parameters.length) {
				var parametersRow = domConstruct.create("tr", null, table);
				domConstruct.create("td", { "class": "propertyRowLabel", textContent: "Comodines:" }, parametersRow);
				domConstruct.create("td", {
					"class": "propertyRowValue",
					textContent: array.map(parameters, function(parameter) {
						return "#" + parameter.name + " (" + parameter.label + ")";
					}).join(", ")
				}, parametersRow);
			}

			if (this._invalid) {
				this.setMessage("La consulta todavía no se puede guardar: " + errors.join(" "), "error");
			}
			this._loadProjects();
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

		// Proyectos activos y, al editar, la asociación actual de la consulta (proyecto y ruta preseleccionados).
		_loadProjects: function() {
			var association = this.query.id ?
				DqApiClient.listProjectQueries({ queryId: this.query.id }).then(function(associations) {
					return associations instanceof Array && associations.length ? associations[0] : null;
				}) : null;
			DqApiClient.listProjects("ACTIVE").then(lang.hitch(this, function(projects) {
				projects = (projects instanceof Array ? projects : []).slice().sort(function(a, b) {
					return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
				});
				var options = [ { label: projects.length ? "Seleccione un proyecto" : "No hay proyectos activos", value: "" } ];
				array.forEach(projects, function(project) {
					options.push({ label: project.name, value: String(project.id) });
				});
				return association ? association.then(lang.hitch(this, function(current) {
					this._association = current;
					if (current && !array.some(options, function(option) { return option.value === String(current.projectId); })) {
						// Asociada a un proyecto que ya no está activo: se muestra para no cambiarlo sin querer.
						options.push({ label: "Proyecto " + current.projectId + " (inactivo)", value: String(current.projectId) });
					}
					return options;
				})) : options;
			})).then(lang.hitch(this, function(options) {
				this._projectField.set("options", options);
				this._projectField.set("value", this._association ? String(this._association.projectId) : "");
				this._projectField.set("disabled", false);
				if (this._association) {
					this._pathField.set("value", QuerySerializer.fromGroupingConfig(this._association.config));
				}
				this._saveButton.set("disabled", this._invalid);
			}), lang.hitch(this, function(error) {
				this._projectField.set("options", [ { label: "No se pudieron cargar los proyectos", value: "" } ]);
				this.setMessage("No se pudieron cargar los proyectos: " + error.message, "error");
			}));
		},

		_onSave: function() {
			var nameValid = this._nameField.validate();
			var pathValid = this._pathField.validate();
			var projectId = Number(this._projectField.get("value"));
			if (!nameValid || !pathValid || !projectId) {
				this.setMessage("Complete los campos obligatorios.", "error");
				return;
			}
			this._saveButton.set("disabled", true);
			this.setMessage("", "info");

			var isNew = !this.query.id;
			var body = {
				name: this._nameField.get("value"),
				cesql: this._cesql,
				config: this._config,
				status: this._statusField.get("value")
			};
			var groupingConfig = QuerySerializer.toGroupingConfig(this._pathField.get("value"));
			var savedQuery;

			// 1. La consulta.
			(isNew ? DqApiClient.createQuery(body) : DqApiClient.updateQuery(this.query.id, body)).then(lang.hitch(this, function(saved) {
				savedQuery = saved;
				// 2. Con su id, la asociación al proyecto.
				return this._saveAssociation(projectId, saved.id, groupingConfig).then(null, lang.hitch(this, function(error) {
					return this._onAssociationFailed(isNew, saved, error);
				}));
			})).then(lang.hitch(this, function() {
				this.onSaved(savedQuery);
				this.hide();
			}), lang.hitch(this, function(error) {
				this.setMessage(error.message, "error");
				this._saveButton.set("disabled", false);
			}));
		},

		// Crea la asociación o, al editar, actualiza la existente si cambió el proyecto o la ruta de agrupación.
		_saveAssociation: function(projectId, queryId, groupingConfig) {
			var current = this._association;
			var association = { projectId: projectId, queryId: queryId, config: groupingConfig };
			if (!current) {
				return DqApiClient.createProjectQuery(association).then(lang.hitch(this, function(created) {
					this._association = created;
					return created;
				}));
			}
			if (current.projectId === projectId && current.config === groupingConfig) {
				return when(current);
			}
			return DqApiClient.updateProjectQuery(current.id, association).then(lang.hitch(this, function(updated) {
				this._association = updated;
				return updated;
			}));
		},

		// Rechaza con un mensaje que dice en qué quedó la consulta.
		_onAssociationFailed: function(isNew, savedQuery, error) {
			var reason = "No se pudo asociar la consulta al proyecto: " + error.message;
			if (!isNew) {
				throw { status: error.status, code: error.code, message: reason + " Los cambios de la consulta sí se guardaron." };
			}
			// Consulta nueva: se elimina para no dejarla sin proyecto.
			return DqApiClient.deleteQuery(savedQuery.id).then(function() {
				throw { status: error.status, code: error.code, message: reason + " La consulta no se guardó." };
			}, lang.hitch(this, function() {
				// No se pudo deshacer: la consulta existe sin proyecto. Al reintentar se actualiza en vez de crear otra.
				this.query = lang.mixin({}, this.query, { id: savedQuery.id });
				this.onSaved(savedQuery);
				throw {
					status: error.status,
					code: error.code,
					message: reason + " La consulta quedó guardada sin proyecto; vuelva a intentar para asociarla."
				};
			}));
		},

		/**
		 * Se invoca con la consulta guardada tal como la devolvió el servicio ({ id, name, cesql, config, status, ... }).
		 */
		onSaved: function(savedQuery) {
		}
	});
});
