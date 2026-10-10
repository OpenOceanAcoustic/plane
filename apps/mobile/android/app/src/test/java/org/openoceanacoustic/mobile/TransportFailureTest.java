// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only

package org.openoceanacoustic.mobile;

import static org.junit.Assert.*;
import java.io.IOException;
import javax.crypto.AEADBadTagException;
import org.junit.Test;

public class TransportFailureTest {
    @Test public void diagnosticsNeverIncludeCredentialBearingInputsOrExceptionMessages() {
        String secret = "http://host/auth/?ticket=secret Cookie=session TOTP=123456";
        String diagnostic = TransportFailure.diagnostic(secret, new IOException(secret));
        assertEquals("operation=unknown category=MOBILE_NETWORK exception=IOException", diagnostic);
        assertFalse(diagnostic.contains(secret));
    }

    @Test public void encryptedSessionStorageFailuresRemainDistinctFromNetworkFailures() {
        Exception failure = new TransportFailure.SessionStorageFailure(new AEADBadTagException("private credential"));
        assertEquals("MOBILE_SESSION_STORAGE", TransportFailure.code("request", failure));
        assertEquals("operation=request category=MOBILE_SESSION_STORAGE exception=AEADBadTagException", TransportFailure.diagnostic("request", failure));
        assertEquals("MOBILE_FILE", TransportFailure.code("pickFile", new IOException("file path")));
        assertEquals("INVALID_REQUEST", TransportFailure.code("request", new IllegalArgumentException("invalid path")));
    }
}
