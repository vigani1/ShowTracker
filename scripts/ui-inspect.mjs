import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium, devices } from "@playwright/test";

const baseUrl = process.env.UI_BASE_URL ?? "http://localhost:8081";
const outputDir = path.resolve(
  process.cwd(),
  process.env.UI_SHOT_DIR ?? "artifacts/ui-inspect"
);
const headless = process.env.PW_HEADLESS !== "false";
const timestamp = new Date().toISOString().replaceAll(":", "-");
const preset = (process.env.UI_INSPECT_PRESET ?? "full").toLowerCase();

function numberEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null) {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

function parseCsvEnv(name, fallbackValues) {
  const raw = process.env[name];
  if (!raw) {
    return fallbackValues;
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeRoute(route) {
  if (!route.startsWith("/")) {
    return `/${route}`;
  }
  return route;
}

const defaultDesktopRoutes =
  preset === "quick" ? ["/profile", "/search"] : ["/", "/discover", "/search", "/profile"];
const defaultMobileRoutes = preset === "quick" ? ["/"] : ["/", "/discover"];
const globalRouteOverride = parseCsvEnv("UI_INSPECT_ROUTES", []);
const desktopRoutes = (globalRouteOverride.length > 0
  ? globalRouteOverride
  : parseCsvEnv("UI_INSPECT_DESKTOP_ROUTES", defaultDesktopRoutes)
).map(normalizeRoute);
const mobileRoutes = (globalRouteOverride.length > 0
  ? globalRouteOverride
  : parseCsvEnv("UI_INSPECT_MOBILE_ROUTES", defaultMobileRoutes)
).map(normalizeRoute);

const themeTestIds = {
  light: "theme-light",
  dark: "theme-dark",
};
const defaultThemes = preset === "quick" ? ["dark"] : ["light", "dark"];
const themes = parseCsvEnv("UI_INSPECT_THEMES", defaultThemes).map((themeKey) => ({
  key: themeKey,
  testId: themeTestIds[themeKey] ?? null,
}));

const contextCatalog = {
  desktop: {
    options: { viewport: { width: 1512, height: 980 } },
    routes: desktopRoutes,
  },
  mobile: {
    options: {
      ...devices["iPhone 13"],
      locale: "en-US",
      timezoneId: "America/New_York",
    },
    routes: mobileRoutes,
  },
  "mobile-window": {
    options: { viewport: { width: 390, height: 844 } },
    routes: mobileRoutes,
  },
};
const defaultContexts = preset === "quick" ? ["desktop"] : ["desktop", "mobile", "mobile-window"];
const contextsToRun = parseCsvEnv("UI_INSPECT_CONTEXTS", defaultContexts).filter(
  (contextName) => contextName in contextCatalog
);

const navTimeoutMs = numberEnv("UI_NAV_TIMEOUT_MS", 30000);
const loginWaitMs = numberEnv("UI_LOGIN_WAIT_MS", 500);
const postLoginWaitMs = numberEnv("UI_POST_LOGIN_WAIT_MS", 1200);
const themeWaitMs = numberEnv("UI_THEME_WAIT_MS", 450);
const routeWaitMs = numberEnv("UI_ROUTE_WAIT_MS", 800);
const uiReadyTimeoutMs = numberEnv("UI_READY_TIMEOUT_MS", 15000);
const skipLogin = booleanEnv("UI_SKIP_LOGIN", false);
const loginAttempts = numberEnv("UI_LOGIN_ATTEMPTS", 2);
const AUTH_ROUTE_PATHS = new Set(["/login", "/register"]);
const IGNORED_WARNING_SUBSTRINGS = [
  "props.pointerEvents is deprecated. Use style.pointerEvents",
];
const UI_READY_CUES = [
  "watch board",
  "tv + anime",
  "loading your dashboard",
  "discover",
  "search",
  "profile",
  "shows",
  "movies",
  "preferences",
  "current status",
];

function getRouteReadyCues(route) {
  switch (route) {
    case "/":
      return ["watch board", "tv + anime", "loading your dashboard"];
    case "/discover":
      return ["discover"];
    case "/search":
      return ["search"];
    case "/profile":
      return ["preferences", "current status", "appearance"];
    default:
      return UI_READY_CUES;
  }
}

function sanitizeRoute(route) {
  const baseRoute = route.split(/[?#]/, 1)[0] ?? "";
  if (!baseRoute || baseRoute === "/") {
    return "home";
  }

  const sanitized = baseRoute
    .replaceAll("/", "_")
    .replace(/^_+/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || "home";
}

function buildSummary(findings) {
  return findings.reduce((acc, finding) => {
    const key = `${finding.context}:${finding.theme}`;
    const issueCount =
      finding.errors.length +
      finding.pageErrors.length +
      finding.requestFailures.length;

    if (!acc[key]) {
      acc[key] = { shots: 0, issues: 0 };
    }
    acc[key].shots += finding.screenshot ? 1 : 0;
    acc[key].issues += issueCount;
    return acc;
  }, {});
}

function getPathname(urlString) {
  try {
    return new URL(urlString).pathname;
  } catch {
    return "";
  }
}

function shouldIgnoreWarning(messageText) {
  return IGNORED_WARNING_SUBSTRINGS.some((pattern) =>
    messageText.includes(pattern)
  );
}

async function waitForUiReady(page, contextName, route, themeKey) {
  const readyCues = getRouteReadyCues(route);

  try {
    await page.waitForFunction(
      ({ cues }) => {
        const body = document.body;
        if (!body) {
          return false;
        }

        const text = (body.innerText ?? "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();
        if (text.length < 20) {
          return false;
        }

        const authIndicators = [
          "continue as guest",
          "access your watch data",
          "need an account? create one",
        ];
        if (authIndicators.every((cue) => text.includes(cue))) {
          return false;
        }

        return cues.some((cue) => text.includes(cue));
      },
      { cues: readyCues },
      { timeout: uiReadyTimeoutMs }
    );
    return true;
  } catch (error) {
    console.warn(
      `[ui-inspect] UI readiness timeout for ${route} (${contextName}, ${themeKey}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
}

async function isAuthScreen(page) {
  const { pathname, bodyText } = await page
    .evaluate(() => ({
      pathname: window.location.pathname ?? "",
      bodyText: (document.body?.innerText ?? "").toLowerCase(),
    }))
    .catch(() => ({ pathname: getPathname(page.url()), bodyText: "" }));

  if (
    AUTH_ROUTE_PATHS.has(pathname) ||
    /^\/(login|register)(\/|$)/.test(pathname)
  ) {
    return true;
  }

  const guestButtonVisible = await page
    .getByText(/continue as guest/i)
    .isVisible()
    .catch(() => false);
  const authSubtitleVisible = await page
    .getByText(/access your watch data/i)
    .isVisible()
    .catch(() => false);
  if (guestButtonVisible && authSubtitleVisible) {
    return true;
  }

  const authCueCount = [
    "continue as guest",
    "access your watch data",
    "need an account? create one",
    "sign in",
    "email",
    "password",
  ].filter((cue) => bodyText.includes(cue)).length;
  const appCueCount = [
    "watch board",
    "tv + anime",
    "loading your dashboard",
    "discover",
    "search",
    "profile",
    "shows",
    "movies",
    "preferences",
    "current status",
  ].filter((cue) => bodyText.includes(cue)).length;

  if (authCueCount >= 3 && appCueCount <= 1) {
    return true;
  }

  return false;
}

async function performGuestLogin(page, contextName, reason = "initial") {
  if (skipLogin) {
    return false;
  }

  let lastFailureMessage = "";

  for (let attempt = 1; attempt <= loginAttempts; attempt += 1) {
    try {
      await page.goto(`${baseUrl}/login`, {
        waitUntil: "domcontentloaded",
        timeout: navTimeoutMs,
      });
      await page.waitForTimeout(loginWaitMs);

      const guestButton = page.getByText(/continue as guest/i);
      await guestButton
        .waitFor({ state: "visible", timeout: 8000 })
        .catch(() => undefined);
      if (!(await guestButton.isVisible().catch(() => false))) {
        lastFailureMessage = `Guest button not visible (${contextName}, ${reason}, attempt ${attempt})`;
        continue;
      }

      await guestButton.scrollIntoViewIfNeeded().catch(() => undefined);
      await guestButton.click({ force: true });
      await page
        .waitForURL((url) => !AUTH_ROUTE_PATHS.has(url.pathname), {
          timeout: 10000,
        })
        .catch(() => undefined);
      await page.waitForTimeout(postLoginWaitMs);

      const authScreenVisible = await isAuthScreen(page);
      if (!authScreenVisible) {
        console.log(
          `[ui-inspect] Guest login completed (${contextName}, ${reason})`
        );
        return true;
      }
    } catch (error) {
      lastFailureMessage = `Guest login failed (${contextName}, ${reason}, attempt ${attempt}): ${
          error instanceof Error ? error.message : String(error)
        }`;
    }
  }

  if (lastFailureMessage) {
    console.warn(`[ui-inspect] ${lastFailureMessage}`);
  }

  return false;
}

async function navigateWithAuthRecovery(
  page,
  contextName,
  targetUrl,
  settleWaitMs,
  reason
) {
  let authRecovered = false;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: navTimeoutMs,
    });
    await page.waitForTimeout(settleWaitMs);

    const authVisible = await isAuthScreen(page);
    if (!authVisible) {
      return { authRecovered, authVisible: false };
    }

    if (skipLogin) {
      break;
    }

    const recovered = await performGuestLogin(
      page,
      contextName,
      `${reason} (attempt ${attempt})`
    );
    authRecovered = authRecovered || recovered;
    if (!recovered) {
      break;
    }
  }

  return { authRecovered, authVisible: await isAuthScreen(page) };
}

async function captureSet(browser, contextName, contextOptions, routes) {
  const context = await browser.newContext(contextOptions);
  const findings = [];
  const page = await context.newPage();

  await performGuestLogin(page, contextName);

  page.on("console", (message) => {
    // eslint-disable-next-line no-console
    if (message.type() === "warning") {
      const warning = message.text();
      if (shouldIgnoreWarning(warning)) {
        return;
      }
      console.log(`[ui-inspect:${contextName}:warning] ${warning}`);
    }
  });

  for (const theme of themes) {
    try {
      const profileNav = await navigateWithAuthRecovery(
        page,
        contextName,
        `${baseUrl}/profile`,
        themeWaitMs,
        "set-theme"
      );
      if (profileNav.authVisible) {
        console.warn(
          `[ui-inspect] Theme setup blocked by auth screen (${contextName}, ${theme.key})`
        );
      }

      if (theme.testId) {
        const themeButton = page.getByTestId(theme.testId);
        if (await themeButton.isVisible().catch(() => false)) {
          await themeButton.click();
          await page.waitForTimeout(themeWaitMs);
        }
      }
      console.log(`[ui-inspect] Theme set to ${theme.key} (${contextName})`);
    } catch (error) {
      console.warn(
        `[ui-inspect] Unable to set ${theme.key} theme (${contextName}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    for (const route of routes) {
      const url = `${baseUrl}${route}`;
      const pageFindings = {
        context: contextName,
        theme: theme.key,
        route,
        url,
        finalUrl: "",
        isAuthScreen: false,
        errors: [],
        warnings: [],
        pageErrors: [],
        requestFailures: [],
        screenshot: "",
        latestScreenshot: "",
        authRecovered: false,
      };

      const handleConsole = (message) => {
        if (message.type() === "error") {
          pageFindings.errors.push(message.text());
        } else if (message.type() === "warning") {
          const warning = message.text();
          if (shouldIgnoreWarning(warning)) {
            return;
          }
          pageFindings.warnings.push(warning);
        }
      };

      const handlePageError = (error) => {
        pageFindings.pageErrors.push(error.message);
      };

      const handleRequestFailed = (request) => {
        const errorText = request.failure()?.errorText ?? "unknown";
        if (errorText === "net::ERR_ABORTED") {
          return;
        }

        pageFindings.requestFailures.push(
          `${request.method()} ${request.url()} (${errorText})`
        );
      };

      page.on("console", handleConsole);
      page.on("pageerror", handlePageError);
      page.on("requestfailed", handleRequestFailed);

      try {
        const navigation = await navigateWithAuthRecovery(
          page,
          contextName,
          url,
          routeWaitMs,
          `capture:${route}:${theme.key}`
        );
        pageFindings.authRecovered = navigation.authRecovered;

        pageFindings.finalUrl = page.url();
        pageFindings.isAuthScreen = navigation.authVisible;

        if (navigation.authVisible) {
          pageFindings.pageErrors.push("Auth screen visible after recovery attempts.");
          console.warn(
            `[ui-inspect] Skipping capture for ${route} (${contextName}, ${theme.key}) because auth could not recover`
          );
          continue;
        }

        const ready = await waitForUiReady(
          page,
          contextName,
          route,
          theme.key
        );
        if (!ready) {
          pageFindings.pageErrors.push(
            `UI readiness timeout before capture for ${route} (${contextName}, ${theme.key}).`
          );
          continue;
        }

        await page.waitForTimeout(350);
        const authBeforeCapture = await isAuthScreen(page);
        if (authBeforeCapture) {
          pageFindings.finalUrl = page.url();
          pageFindings.isAuthScreen = true;
          pageFindings.pageErrors.push(
            `Auth screen appeared before capture for ${route} (${contextName}, ${theme.key}).`
          );
          console.warn(
            `[ui-inspect] Skipping capture for ${route} (${contextName}, ${theme.key}) because auth reappeared before screenshot`
          );
          continue;
        }

        const screenshotName = `${contextName}-${theme.key}-${sanitizeRoute(route)}.png`;
        const screenshotPath = path.join(
          outputDir,
          `${timestamp}-${screenshotName}`
        );
        const latestScreenshotPath = path.join(
          outputDir,
          `latest-${screenshotName}`
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });
        pageFindings.finalUrl = page.url();
        fs.copyFileSync(screenshotPath, latestScreenshotPath);
        pageFindings.screenshot = screenshotPath;
        pageFindings.latestScreenshot = latestScreenshotPath;
        console.log(
          `[ui-inspect] Captured ${route} (${contextName}, ${theme.key})`
        );
      } catch (error) {
        pageFindings.pageErrors.push(
          error instanceof Error ? error.message : String(error)
        );
        console.error(
          `[ui-inspect] Failed ${route} (${contextName}, ${theme.key})`
        );
      } finally {
        page.off("console", handleConsole);
        page.off("pageerror", handlePageError);
        page.off("requestfailed", handleRequestFailed);
        findings.push(pageFindings);
      }
    }
  }

  await page.close();
  await context.close();
  return findings;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(
    `[ui-inspect] preset=${preset}, contexts=${contextsToRun.join(",")}, themes=${themes
      .map((theme) => theme.key)
      .join(",")}`
  );

  const browser = await chromium.launch({ headless });
  const allFindings = [];

  try {
    for (const contextName of contextsToRun) {
      const contextEntry = contextCatalog[contextName];
      if (!contextEntry) {
        continue;
      }

      const findings = await captureSet(
        browser,
        contextName,
        contextEntry.options,
        contextEntry.routes
      );
      allFindings.push(...findings);
    }
  } finally {
    await browser.close();
  }

  const reportPath = path.join(outputDir, `${timestamp}-report.json`);
  const latestReportPath = path.join(outputDir, "latest-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(allFindings, null, 2));
  fs.writeFileSync(latestReportPath, JSON.stringify(allFindings, null, 2));

  const totalErrors =
    allFindings.reduce(
      (count, entry) =>
        count +
        entry.errors.length +
        entry.pageErrors.length +
        entry.requestFailures.length,
      0
    ) ?? 0;

  console.log(`[ui-inspect] Report saved to ${reportPath}`);
  console.log(`[ui-inspect] Latest report updated at ${latestReportPath}`);

  const summary = buildSummary(allFindings);
  for (const [key, values] of Object.entries(summary)) {
    console.log(
      `[ui-inspect] ${key} -> screenshots: ${values.shots}, issues: ${values.issues}`
    );
  }

  if (totalErrors > 0) {
    console.log(`[ui-inspect] Found ${totalErrors} potential issues.`);
  } else {
    console.log("[ui-inspect] No console/request failures captured.");
  }
}

main().catch((error) => {
  console.error("[ui-inspect] Fatal error", error);
  process.exit(1);
});
