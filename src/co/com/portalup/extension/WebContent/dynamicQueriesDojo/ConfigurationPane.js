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
		 * @class Configuración del plug-in: repositorio de las consultas, URL del microservicio de DQ, grupos con acceso
		 *        al diseñador, servicio de descarga de los documentos en S3 (URL y API key) y composición de los que tienen
		 *        file_key multivalor (credenciales de Azure y timeout).
		 *        La lee co.com.portalup.extension.PluginConfiguration en el servidor; los nombres deben coincidir.
		 * @augments ecm.widget.admin.PluginConfigurationPane
		 */
		return declare("dynamicQueriesDojo.ConfigurationPane", [ PluginConfigurationPane, _TemplatedMixin, _WidgetsInTemplateMixin], {

		templateString: template,
		widgetsInTemplate: true,

		// Debe coincidir con PluginConfiguration.DEFAULT_PROJECTS_API_URL, que el servidor usa mientras no se guarde otra.
		defaultProjectsApiUrl: "https://localhost:8443/api/v1",

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
			this.projectsApiUrlField.set("value",
				"projectsApiUrl" in values ? values.projectsApiUrl || "" : this.defaultProjectsApiUrl, false);
			this.designerGroupsField.set("value", values.designerGroups || "", false);
			this.s3DownloadUrlField.set("value", values.s3DownloadUrl || "", false);
			this.s3ApiKeyField.set("value", values.s3ApiKey || "", false);
			this.azureTokenUrlField.set("value", values.azureTokenUrl || "", false);
			this.azureClientIdField.set("value", values.azureClientId || "", false);
			this.azureClientSecretField.set("value", values.azureClientSecret || "", false);
			this.azureResourceField.set("value", values.azureResource || "", false);
			this.composeTimeoutSecondsField.set("value", values.composeTimeoutSeconds || "", false);
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
					{ name: "projectsApiUrl", value: this.projectsApiUrlField.get("value") },
					{ name: "designerGroups", value: this.designerGroupsField.get("value") },
					{ name: "s3DownloadUrl", value: this.s3DownloadUrlField.get("value") },
					{ name: "s3ApiKey", value: this.s3ApiKeyField.get("value") },
					{ name: "azureTokenUrl", value: this.azureTokenUrlField.get("value") },
					{ name: "azureClientId", value: this.azureClientIdField.get("value") },
					{ name: "azureClientSecret", value: this.azureClientSecretField.get("value") },
					{ name: "azureResource", value: this.azureResourceField.get("value") },
					{ name: "composeTimeoutSeconds", value: this.composeTimeoutSecondsField.get("value") }
				]
			});
			this.onSaveNeeded(true);
		},

		validate: function() {
			return !!this.repositoryIdField.get("value") && this.projectsApiUrlField.isValid() && this.s3DownloadUrlField.isValid()
				&& this.azureTokenUrlField.isValid() && this.composeTimeoutSecondsField.isValid();
		}
	});
});
