define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/json",
	"dojo/request/xhr",
	"dojo/store/Memory",
	"dojo/data/ObjectStore",
	"dijit/tree/ObjectStoreModel",
	"dijit/Tree",
	"dojox/grid/DataGrid",
	"ecm/widget/dialog/MessageDialog",
	"ecm/widget/layout/_LaunchBarPane",
	"dojo/text!./templates/DQResults.html",
	// Script sin AMD: define window.UTIF (decodificador de TIFF).
	"dynamicQueriesDojo/UTIF",
	"idx/layout/BorderContainer",
	"dijit/layout/BorderContainer",
	"dijit/layout/ContentPane",
	"dijit/form/Select",
	"dijit/form/TextBox",
	"dijit/form/Button"
],
function(declare,
		lang,
		array,
		domClass,
		domConstruct,
		JSON,
		xhr,
		Memory,
		ObjectStore,
		ObjectStoreModel,
		Tree,
		DataGrid,
		MessageDialog,
		_LaunchBarPane,
		template) {

	// Backend de GQViewFeature (aplicación portalUpApp, en el mismo servidor que ICN).
	var API_CONTEXT = "/portalUpApp";
	// Escritorio de ICN con el que bookmark.jsp muestra los documentos que no vienen de S3.
	var VIEWER_DESKTOP = "LPADocViewer";
	// Propiedad cuyo valor es el contenido del documento en base64 (documentos en S3).
	var S3_FILE = "s3file";

	var MIME_TYPES = {
		pdf: "application/pdf",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		png: "image/png",
		gif: "image/gif",
		bmp: "image/bmp",
		tiff: "image/tiff",
		tif: "image/tiff",
		webp: "image/webp",
		svg: "image/svg+xml",
		heic: "image/heic",
		txt: "text/plain",
		csv: "text/csv",
		json: "application/json",
		xml: "application/xml"
	};

	function base64ToBytes(base64Data) {
		var binary = atob(base64Data);
		var bytes = new Uint8Array(binary.length);
		for (var i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}

	/**
	 * @name dynamicQueriesDojo.DQResults
	 * @class Feature pane "Resultados de consultas": copia de GQViewFeature (PortalUpICN). Busca documentos por tipo y
	 *        número de identificación, los muestra en un árbol de carpetas y, al elegir uno, sus propiedades y el
	 *        documento. Base para mostrar los resultados de las consultas del diseñador.
	 * @augments ecm.widget.layout._LaunchBarPane
	 */
	return declare("dynamicQueriesDojo.DQResults", [
		_LaunchBarPane
	], {
		/** @lends dynamicQueriesDojo.DQResults.prototype */

		templateString: template,

		// Set to true if widget template contains DOJO widgets.
		widgetsInTemplate: true,

		postCreate: function() {
			this.logEntry("postCreate");
			this.inherited(arguments);

			this._buildTree([ { id: "root", name: "Documentos", type: "folder" } ]);

			this._gridStore = new Memory({ data: [] });
			this.grid = new DataGrid({
				store: new ObjectStore({ objectStore: this._gridStore }),
				structure: [
					{ name: "Nombre", field: "key", width: "50%" },
					{ name: "Valor", field: "value", width: "50%" }
				],
				style: "width:100%; height:100%;"
			}, this.gridNode);
			this.grid.startup();

			this.logExit("postCreate");
		},

		/**
		 * Optional method that sets additional parameters when the user clicks on the launch button associated with
		 * this feature.
		 */
		setParams: function(params) {
			this.logEntry("setParams", params);

			if (params) {

				if (!this.isLoaded && this.selected) {
					this.loadContent();
				}
			}

			this.logExit("setParams");
		},

		/**
		 * Loads the content of the pane. This is a required method to insert a pane into the LaunchBarContainer.
		 */
		loadContent: function() {
			this.logEntry("loadContent");

			if (!this.isLoaded) {
				this.isLoaded = true;
				this.needReset = false;
			}

			this.logExit("loadContent");
		},

		/**
		 * Resets the content of this pane.
		 */
		reset: function() {
			this.logEntry("reset");

			this.needReset = false;

			this.logExit("reset");
		},

		destroy: function() {
			this._revokeViewerUrl();
			this.inherited(arguments);
		},

		// Buscar: documentos del tipo y número de identificación, agrupados en carpetas.
		_onSearch: function() {
			this._showLoading(true);
			var payload = {
				identificationNumber: this.numIdField.get("value"),
				typeIdentification: this.tipoIdField.get("value")
			};
			xhr.post(API_CONTEXT + "/api/documents/queryContent", {
				data: JSON.stringify(payload),
				handleAs: "json",
				headers: { "Content-Type": "application/json" }
			}).then(lang.hitch(this, function(response) {
				this._showLoading(false);
				this._clearScreen();
				if (response && response.length > 0) {
					this._buildTree(this.buildTreeData(response));
				} else {
					this._showAlert("La búsqueda no obtuvo resultados.");
					this.numIdField.set("value", "");
				}
			}), lang.hitch(this, function(error) {
				this._showLoading(false);
				console.error("DQResults: error en la consulta", error);
				this._showAlert("Ocurrió un error al procesar la búsqueda.");
				this.numIdField.set("value", "");
				this._clearScreen();
			}));
		},

		/**
		 * Convierte la respuesta de queryContent en los items del árbol. Cada elemento trae en text la ruta de carpetas
		 * separada por comas y en children sus documentos ({ text, viewerUrl, mimeType, data }).
		 */
		buildTreeData: function(response) {
			var data = [ { id: "root", name: "Documentos", type: "folder" } ];
			// Carpeta ya creada por ruta completa, para no repetirla.
			var folderIds = {};
			var idCounter = 1;

			array.forEach(response, function(entry) {
				var parentId = "root";
				array.forEach(String(entry.text).split(","), function(folderName) {
					folderName = folderName.trim();
					var pathKey = parentId + "/" + folderName;
					if (!folderIds[pathKey]) {
						folderIds[pathKey] = "f" + (idCounter++);
						data.push({ id: folderIds[pathKey], name: folderName, type: "folder", parent: parentId });
					}
					parentId = folderIds[pathKey];
				});

				array.forEach(entry.children || [], function(child) {
					data.push({
						id: "d" + (idCounter++),
						name: String(child.text).trim(),
						type: "document",
						parent: parentId,
						viewerUrl: child.viewerUrl || null,
						mimeType: child.mimeType || null,
						data: child.data || null
					});
				});
			});

			return data;
		},

		_buildTree: function(treeData) {
			var store = new Memory({
				data: treeData,
				getChildren: function(object) {
					return this.query({ parent: object.id });
				}
			});
			var model = new ObjectStoreModel({
				store: store,
				query: { id: "root" },
				mayHaveChildren: function(item) {
					return item.type === "folder";
				}
			});

			this._destroyTree();
			this.tree = new Tree({
				model: model,
				showRoot: false,
				getIconClass: lang.hitch(this, this._getIconClass),
				onClick: lang.hitch(this, function(item) {
					if (item && item.type === "document") {
						this.getDocumentProperties(item.data);
					}
				})
			});
			this.tree.placeAt(this.treeNode);
			this.tree.startup();
		},

		_destroyTree: function() {
			if (this.tree) {
				this.tree.destroyRecursive();
				this.tree = null;
			}
			domConstruct.empty(this.treeNode);
		},

		_getIconClass: function(item, opened) {
			if (!item) {
				return "dijitLeaf";
			}
			if (item.type === "folder") {
				return opened ? "dijitFolderOpened" : "dijitFolderClosed";
			}
			if (item.type !== "document") {
				return "dijitLeaf";
			}
			var mimeType = item.mimeType;
			if (!mimeType) {
				mimeType = this.getMimeType("filename." + (this.extractFileExtensionByTextNode(item.name) || "bin"));
			}
			if (mimeType === "application/pdf") {
				return "dqResultsIconPdf";
			} else if (mimeType.indexOf("tif") !== -1) {
				return "dqResultsIconTiff";
			} else if (mimeType.indexOf("png") !== -1) {
				return "dqResultsIconPng";
			} else if (mimeType.indexOf("jpeg") !== -1 || mimeType.indexOf("jpg") !== -1) {
				return "dqResultsIconJpg";
			} else if (mimeType.indexOf("msword") !== -1 || mimeType.indexOf("wordprocessingml") !== -1) {
				return "dqResultsIconDoc";
			} else if (mimeType.indexOf("excel") !== -1 || mimeType.indexOf("spreadsheetml") !== -1) {
				return "dqResultsIconXls";
			}
			return "dqResultsIconFile";
		},

		/**
		 * Propiedades del documento en el grid y el documento en el visor: con bookmark.jsp de ICN o, si las
		 * propiedades traen el contenido (S3_FILE), decodificado en el navegador.
		 */
		getDocumentProperties: function(doc) {
			if (!doc || !doc.objectStoreName || !doc.objId) {
				console.error("DQResults: documento inválido", doc);
				return;
			}
			this._showLoading(true);
			var payload = {
				objectstore: doc.objectStoreName,
				documentId: doc.objId
			};
			xhr.post(API_CONTEXT + "/api/documents/properties", {
				data: JSON.stringify(payload),
				handleAs: "json",
				headers: { "Content-Type": "application/json" }
			}).then(lang.hitch(this, function(response) {
				var gridData = [];
				var s3FileKey = null;
				var idCounter = 1;
				for (var key in response) {
					if (!response.hasOwnProperty(key)) {
						continue;
					}
					if (key.toLowerCase() === S3_FILE) {
						s3FileKey = key;
					} else {
						gridData.push({ id: idCounter++, key: key, value: response[key] || "" });
					}
				}
				this._loadGridData(gridData);
				if (s3FileKey === null) {
					this._showIcnViewer(doc);
				} else {
					var mimeType = response.MimeType || this.getMimeType(response.DocumentTitle) || "application/pdf";
					this.showViewerBase64(response[s3FileKey], mimeType);
				}
				this._showLoading(false);
			}), lang.hitch(this, function(error) {
				this._showLoading(false);
				console.error("DQResults: error consultando propiedades", error);
				this._showAlert("No se pudieron consultar las propiedades del documento.");
			}));
		},

		_showIcnViewer: function(doc) {
			this._clearViewer();
			domConstruct.create("iframe", {
				src: "/navigator/bookmark.jsp?desktop=" + encodeURIComponent(VIEWER_DESKTOP) +
					"&feature=BookmarkLayout&repositoryId=" + encodeURIComponent(doc.objectStoreName) +
					"&repositoryType=p8&docid=" + encodeURIComponent(doc.objId) + "&embedded=true",
				"class": "dqResultsViewerFrame"
			}, this.viewerNode);
		},

		/**
		 * Muestra un documento en base64: TIFF dibujado en un canvas (UTIF), PDF en un iframe y el resto como imagen.
		 * PDF e imágenes van como blob: (la Content-Security-Policy de ICN no permite data:).
		 */
		showViewerBase64: function(base64Data, mimeType) {
			mimeType = mimeType || "image/png";
			this._clearViewer();
			var bytes = base64ToBytes(base64Data);

			if (mimeType === "image/tiff" || mimeType === "image/tif") {
				var UTIF = window.UTIF;
				var ifds = UTIF.decode(bytes);
				UTIF.decodeImage(bytes, ifds[0]); // Solo la primera página.
				var rgba = UTIF.toRGBA8(ifds[0]);
				var canvas = domConstruct.create("canvas", { width: ifds[0].width, height: ifds[0].height }, this.viewerNode);
				canvas.getContext("2d").putImageData(
					new ImageData(new Uint8ClampedArray(rgba), ifds[0].width, ifds[0].height), 0, 0);
				return;
			}

			this._viewerUrl = URL.createObjectURL(new Blob([ bytes ], { type: mimeType }));
			if (mimeType === "application/pdf") {
				domConstruct.create("iframe", { src: this._viewerUrl, "class": "dqResultsViewerFrame" }, this.viewerNode);
			} else {
				domConstruct.create("img", { src: this._viewerUrl, "class": "dqResultsViewerImage" }, this.viewerNode);
			}
		},

		_clearViewer: function() {
			this._revokeViewerUrl();
			domConstruct.empty(this.viewerNode);
		},

		_revokeViewerUrl: function() {
			if (this._viewerUrl) {
				URL.revokeObjectURL(this._viewerUrl);
				this._viewerUrl = null;
			}
		},

		_loadGridData: function(rows) {
			this._gridStore.setData(rows);
			this.grid.setStore(new ObjectStore({ objectStore: this._gridStore }));
			this.grid.resize();
		},

		_showLoading: function(show) {
			domClass.toggle(this.loadingNode, "dqResultsLoadingVisible", show);
		},

		_showAlert: function(message) {
			new MessageDialog({ text: message }).show();
		},

		_clearScreen: function() {
			this._destroyTree();
			this._loadGridData([]);
			this._clearViewer();
		},

		getMimeType: function(filename) {
			if (typeof filename !== "string" || filename.indexOf(".") === -1) {
				return null;
			}
			return MIME_TYPES[filename.split(".").pop().toLowerCase()] || "application/octet-stream";
		},

		// Extensión a partir del nombre del nodo, que la trae entre corchetes: "Nombre [archivo.pdf]".
		extractFileExtensionByTextNode: function(text) {
			var match = /\[.*?\.([a-zA-Z0-9]+)\]/.exec(text || "");
			return match ? match[1].toLowerCase() : null;
		}
	});
});
