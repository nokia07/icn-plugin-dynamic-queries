define([
		"dojo/_base/declare",
		"dojo/_base/lang",
		"dojo/_base/array",
		"dijit/_TemplatedMixin",
		"dijit/_WidgetsInTemplateMixin",
		"ecm/widget/admin/PluginConfigurationPane",
		"dojo/text!./templates/ConfigurationPane.html",
		"ecm/widget/ValidationTextBox",
		"dijit/form/Select"
	],
	function(declare, lang, array, _TemplatedMixin, _WidgetsInTemplateMixin, PluginConfigurationPane, template) {

		/**
		 * @name dynamicQueriesDojo.ConfigurationPane
		 * @class Configuración del plug-in: repositorio de las consultas y conexión con el servicio de consultas.
		 *        La lee co.com.portalup.extension.PluginConfiguration en el servidor; los nombres deben coincidir.
		 * @augments ecm.widget.admin.PluginConfigurationPane
		 */
		return declare("dynamicQueriesDojo.ConfigurationPane", [ PluginConfigurationPane, _TemplatedMixin, _WidgetsInTemplateMixin], {

		templateString: template,
		widgetsInTemplate: true,

		load: function(callback) {
			var values = {};
			if (this.configurationString) {
				array.forEach(JSON.parse(this.configurationString).configuration || [], function(entry) {
					values[entry.name] = entry.value;
				});
			}
			// Sin disparar onChange (tercer argumento false): cargar no es un cambio, y _onParamChange reescribiría la
			// configuración antes de que llegue la lista de repositorios.
			this._loadRepositories(values.repositoryId || "");
			this.apiUrlField.set("value", values.apiUrl || "", false);
			this.apiTokenField.set("value", values.apiToken || "", false);
			this.timeoutField.set("value", values.timeoutSeconds || "", false);
		},

		// Repositorios P8 configurados en ICN (no solo los de un escritorio): el plug-in es global.
		_loadRepositories: function(selectedId) {
			ecm.model.admin.appCfg.getRepositoryObjects(lang.hitch(this, function(repositories) {
				var options = [ { label: "Seleccione un repositorio", value: "" } ];
				array.forEach(repositories, function(repository) {
					if (repository.getType() === "p8") {
						options.push({
							label: repository.getName() + " (object store " + repository.getObjectStoreDisplayName() + ")",
							value: repository.id
						});
					}
				});
				if (selectedId && !array.some(options, function(option) { return option.value === selectedId; })) {
					options.push({ label: selectedId + " (ya no existe en ICN)", value: selectedId });
				}
				this.repositoryIdField.set("options", options);
				this.repositoryIdField.set("value", selectedId, false);
				this.repositoryIdField.set("disabled", false);
			}));
		},

		_onParamChange: function() {
			this.configurationString = JSON.stringify({
				configuration: [
					{ name: "repositoryId", value: this.repositoryIdField.get("value") },
					{ name: "apiUrl", value: this.apiUrlField.get("value") },
					{ name: "apiToken", value: this.apiTokenField.get("value") },
					{ name: "timeoutSeconds", value: this.timeoutField.get("value") }
				]
			});
			this.onSaveNeeded(true);
		},

		validate: function() {
			return !!this.repositoryIdField.get("value") && this.apiUrlField.isValid() && this.timeoutField.isValid();
		}
	});
});
