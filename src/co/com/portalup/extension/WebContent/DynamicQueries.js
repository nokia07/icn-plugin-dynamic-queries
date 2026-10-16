require([
	"dojo/_base/array",
	"dijit/registry",
	"ecm/model/Desktop",
	"dynamicQueriesDojo/SettingsClient"
],
function(array, registry, Desktop, SettingsClient) {

	/**
	 * Oculta el botón del feature DQ en la barra de features a quien no puede usar el diseñador
	 * (SettingsService.canDesign). Solo es interfaz: el panel DQ vuelve a comprobar el permiso al cargar.
	 *
	 * Se revisa la sesión cada CHECK_INTERVAL ms en lugar de usar los eventos de ICN: en 3.0.10 el layout se construye
	 * antes del login y Desktop.onLogin no avisa del primer inicio de sesión, solo de los siguientes. Además ICN
	 * reutiliza la barra entre sesiones en la misma pestaña, así que el permiso se vuelve a pedir si cambia el usuario.
	 */
	var FEATURE_ID = "DQ"; // DQ.getId()
	var CHECK_INTERVAL = 500;

	// Usuario de la sesión cuyo permiso se pidió ("" sin sesión) y si puede ver el diseñador (null mientras no se sabe:
	// el botón queda oculto).
	var sessionUser = "";
	var canDesign = null;
	var launchBar = null;

	function findLaunchBar() {
		if (!launchBar || launchBar._destroyed) {
			launchBar = array.filter(registry.toArray(), function(widget) {
				return widget.declaredClass === "ecm.widget.layout.LaunchBarContainer";
			})[0] || null;
		}
		return launchBar;
	}

	// Botón de la barra (estilo "toolbar") y entrada del menú (estilo "flyout"), el que exista.
	function applyVisibility() {
		var bar = findLaunchBar();
		if (!bar) {
			return;
		}
		var display = canDesign === true ? "" : "none";
		var button = bar.getButtonByID(FEATURE_ID);
		if (button && button.domNode.style.display !== display) {
			button.domNode.style.display = display;
		}
		if (bar._featureDropDownMenu) {
			array.forEach(bar._featureDropDownMenu.getChildren(), function(item) {
				if (item.feature && item.feature.id === FEATURE_ID && item.domNode.style.display !== display) {
					item.domNode.style.display = display;
				}
			});
		}
	}

	function checkSession() {
		var user = Desktop.connected ? Desktop.userId || "" : "";
		if (user !== sessionUser) {
			sessionUser = user;
			canDesign = null;
			if (user) {
				SettingsClient.getSettings().then(function(settings) {
					if (sessionUser === user) {
						canDesign = !!settings.canDesign;
						applyVisibility();
					}
				}, function() {
					// Sin configuración no se sabe si tiene permiso: el botón sigue oculto.
					if (sessionUser === user) {
						canDesign = false;
					}
				});
			}
		}
		applyVisibility();
	}

	setInterval(checkSession, CHECK_INTERVAL);
});
