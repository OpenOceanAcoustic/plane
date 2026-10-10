// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only

package org.openoceanacoustic.mobile;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.net.URI;
import java.util.Collections;
import org.junit.Test;
import org.junit.runner.RunWith;

/** The public credential persistence seam runs against Android's real Keystore. */
@RunWith(AndroidJUnit4.class)
public class SessionVaultInstrumentedTest {
    @Test public void sessionsAreEncryptedRestoredIsolatedAndCleared() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String origin = "https://keystore-test.invalid";
        SessionVault first = new SessionVault(context);
        try {
            CookieSession session = first.get(origin);
            session.accept(URI.create(origin + "/login"), Collections.singletonList("sessionid=instrumentation-secret; HttpOnly; Path=/; Secure"));
            first.save(origin);
            assertFalse(context.getSharedPreferences("native_sessions_v1", Context.MODE_PRIVATE).getAll().toString().contains("instrumentation-secret"));
            SessionVault restarted = new SessionVault(context);
            assertEquals("sessionid=instrumentation-secret", restarted.get(origin).header(URI.create(origin + "/api/me/")));
            assertEquals("", restarted.get("https://different-test.invalid").header(URI.create("https://different-test.invalid/api/me/")));
            restarted.clear(origin);
            assertEquals("", new SessionVault(context).get(origin).header(URI.create(origin + "/api/me/")));
        } finally { first.clear(origin); first.clear("https://different-test.invalid"); }
    }
}
