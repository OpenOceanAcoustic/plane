// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only

package org.openoceanacoustic.mobile;

import java.io.IOException;

/** Classifies failures without disclosing credentials in native diagnostics. */
final class TransportFailure {
    static final class SessionStorageFailure extends Exception {
        SessionStorageFailure(Exception cause) { super(cause); }
    }

    static String code(String operation, Exception failure) {
        if (failure instanceof IllegalArgumentException) return "INVALID_REQUEST";
        if (failure instanceof SessionStorageFailure) return "MOBILE_SESSION_STORAGE";
        if (failure instanceof IOException) return operation.equals("pickFile") ? "MOBILE_FILE" : "MOBILE_NETWORK";
        return "MOBILE_OPERATION";
    }

    static String diagnostic(String operation, Exception failure) {
        switch (operation) {
            case "request": case "clearSession": case "pickFile": case "uploadFile": case "download": break;
            default: operation = "unknown";
        }
        Throwable source = failure instanceof SessionStorageFailure ? failure.getCause() : failure;
        // Do not log the Throwable itself: exception messages and stacks may contain request values.
        String exception = source.getClass().getSimpleName().replaceAll("[^A-Za-z0-9_$]", "");
        return "operation=" + operation + " category=" + code(operation, failure) + " exception=" + exception;
    }
}
