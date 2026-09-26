define([
		"dojo/_base/declare",
		"dojo/_base/array",
		"dijit/_TemplatedMixin",
		"dijit/_WidgetsInTemplateMixin",
		"ecm/widget/admin/PluginConfigurationPane",
		"dojo/text!./templates/ConfigurationPane.html",
		"ecm/widget/ValidationTextBox"
	],
	function(declare, array, _TemplatedMixin, _WidgetsInTemplateMixin, PluginConfigurationPane, template) {

		/**
		 * @name dynamicQueriesDojo.ConfigurationPane
		 * @class Configuración del plug-in: conexión con el servicio de consultas. La lee
		 *        co.com.portalup.extension.PluginConfiguration en el servidor; los nombres deben coincidir.
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
			this.apiUrlField.set("value", values.apiUrl || "");
			this.apiTokenField.set("value", values.apiToken || "");
			this.timeoutField.set("value", values.timeoutSeconds || "");
		},

		_onParamChange: function() {
			this.configurationString = JSON.stringify({
				configuration: [
					{ name: "apiUrl", value: this.apiUrlField.get("value") },
					{ name: "apiToken", value: this.apiTokenField.get("value") },
					{ name: "timeoutSeconds", value: this.timeoutField.get("value") }
				]
			});
			this.onSaveNeeded(true);
		},

		validate: function() {
			return this.apiUrlField.isValid() && this.timeoutField.isValid();
		}
	});
});
