package co.com.portalup.extension;

/**
 * Error de negocio del almacenamiento de consultas, con el código HTTP y el código de error del contrato
 * (docs/api/dynamic-queries.openapi.yaml). El mensaje es apto para mostrarse al usuario.
 */
public class QueryStoreException extends Exception {

	private static final long serialVersionUID = 1L;

	private final int status;
	private final String code;

	public QueryStoreException(int status, String code, String message) {
		super(message);
		this.status = status;
		this.code = code;
	}

	public QueryStoreException(int status, String code, String message, Throwable cause) {
		super(message, cause);
		this.status = status;
		this.code = code;
	}

	public int getStatus() {
		return status;
	}

	public String getCode() {
		return code;
	}
}
