#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <unistd.h>
#include <signal.h>
#include <libgen.h>
#include <mach-o/dyld.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#define SERVER_PORT 8765

static pid_t g_server_pid = 0;

static int is_port_open(int port) {
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) return 0;
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
    struct timeval tv = {0, 100000};
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    int res = connect(sock, (struct sockaddr *)&addr, sizeof(addr));
    close(sock);
    return (res == 0);
}

@interface StudioAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate>
@property (strong) NSWindow *window;
@property (strong) WKWebView *webView;
@end

@implementation StudioAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSRect frame = NSMakeRect(0, 0, 1440, 920);
    NSUInteger style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                       NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;

    self.window = [[NSWindow alloc] initWithContentRect:frame
                                              styleMask:style
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    [self.window setTitle:@"TurboCompress Studio — Fast Batch Vertical Recoder (Nikon Z8)"];
    [self.window center];
    [self.window setMinSize:NSMakeSize(1100, 700)];
    [self.window setBackgroundColor:[NSColor colorWithCalibratedRed:0.06 green:0.07 blue:0.09 alpha:1.0]];
    [self.window setAppearance:[NSAppearance appearanceNamed:NSAppearanceNameVibrantDark]];
    [self.window setDelegate:self];

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    WKPreferences *prefs = config.preferences;
    prefs.javaScriptCanOpenWindowsAutomatically = YES;

    self.webView = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:config];
    [self.webView setAutoresizingMask:NSViewWidthSizable | NSViewHeightSizable];
    [self.webView setNavigationDelegate:self];
    [self.webView setUIDelegate:self];
    [self.webView setValue:@NO forKey:@"drawsBackground"];

    [self.window.contentView addSubview:self.webView];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];

    NSURL *url = [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%d", SERVER_PORT]];
    NSURLRequest *req = [NSURLRequest requestWithURL:url];
    [self.webView loadRequest:req];
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    // If backend server is still spinning up, retry automatically
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(250 * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
        NSURL *url = [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%d", SERVER_PORT]];
        [self.webView loadRequest:[NSURLRequest requestWithURL:url]];
    });
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    if (g_server_pid > 0) {
        kill(g_server_pid, SIGTERM);
    }
}

// Support Cmd+R reload
- (void)reloadPage:(id)sender {
    [self.webView reload];
}

// Support JS alert and confirm panels in native app
- (void)webView:(WKWebView *)webView
runJavaScriptAlertPanelWithMessage:(NSString *)message
initiatedByFrame:(WKFrameInfo *)frame
completionHandler:(void (^)(void))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:@"TurboCompress Studio"];
    [alert setInformativeText:message];
    [alert addButtonWithTitle:@"OK"];
    [alert runModal];
    completionHandler();
}

- (void)webView:(WKWebView *)webView
runJavaScriptConfirmPanelWithMessage:(NSString *)message
initiatedByFrame:(WKFrameInfo *)frame
completionHandler:(void (^)(BOOL result))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:@"TurboCompress Studio"];
    [alert setInformativeText:message];
    [alert addButtonWithTitle:@"OK"];
    [alert addButtonWithTitle:@"Cancel"];
    NSModalResponse res = [alert runModal];
    completionHandler(res == NSAlertFirstButtonReturn);
}

// Native open panel inside WKWebView
- (void)webView:(WKWebView *)webView
runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
initiatedByFrame:(WKFrameInfo *)frame
completionHandler:(void (^)(NSArray<NSURL *> * _Nullable))completionHandler {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    BOOL pickDirs = [parameters allowsDirectories];
    [panel setCanChooseFiles:!pickDirs];
    [panel setCanChooseDirectories:pickDirs];
    [panel setAllowsMultipleSelection:YES];
    [panel setResolvesAliases:YES];
    [panel setPrompt:pickDirs ? @"Select Folder" : @"Select Videos"];

    [panel beginWithCompletionHandler:^(NSModalResponse result) {
        if (result == NSModalResponseOK) {
            completionHandler([panel URLs]);
        } else {
            completionHandler(nil);
        }
    }];
}

@end

static void setup_menu(StudioAppDelegate *delegate) {
    NSMenu *menubar = [[NSMenu alloc] init];

    // App Menu
    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:appMenuItem];
    NSMenu *appMenu = [[NSMenu alloc] init];
    [appMenu addItemWithTitle:@"About TurboCompress Studio" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    NSMenuItem *reloadItem = [[NSMenuItem alloc] initWithTitle:@"Reload UI" action:@selector(reloadPage:) keyEquivalent:@"r"];
    [reloadItem setTarget:delegate];
    [appMenu addItem:reloadItem];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"Hide TurboCompress" action:@selector(hide:) keyEquivalent:@"h"];
    [appMenu addItemWithTitle:@"Quit TurboCompress Studio" action:@selector(terminate:) keyEquivalent:@"q"];
    [appMenuItem setSubmenu:appMenu];

    // Edit Menu (Cmd+A Select All, Cmd+C, Cmd+V, Cmd+Z)
    NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:editMenuItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
    [editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
    [editMenuItem setSubmenu:editMenu];

    // Window Menu
    NSMenuItem *winMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:winMenuItem];
    NSMenu *winMenu = [[NSMenu alloc] initWithTitle:@"Window"];
    [winMenu addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
    [winMenu addItemWithTitle:@"Zoom" action:@selector(performZoom:) keyEquivalent:@""];
    [winMenuItem setSubmenu:winMenu];

    [NSApp setMainMenu:menubar];
}

int main(int argc, const char *argv[]) {
    signal(SIGPIPE, SIG_IGN);
    @autoreleasepool {
        // Start background python server if port not open
        if (!is_port_open(SERVER_PORT)) {
            char exe_path[2048];
            uint32_t size = sizeof(exe_path);
            _NSGetExecutablePath(exe_path, &size);
            char real_exe[2048];
            if (!realpath(exe_path, real_exe)) strncpy(real_exe, exe_path, sizeof(real_exe));
            char *dir = dirname(real_exe);

            char server_script[2048];
            snprintf(server_script, sizeof(server_script), "%s/../Resources/server.py", dir);
            if (access(server_script, F_OK) != 0) {
                snprintf(server_script, sizeof(server_script), "%s/../../TurboCompress/server.py", dir);
            }

            pid_t pid = fork();
            if (pid == 0) {
                // Child: run python server
                char *s_dir = dirname(strdup(server_script));
                chdir(s_dir);
                execl("/Library/Frameworks/Python.framework/Versions/3.14/bin/python3",
                      "python3", server_script, NULL);
                execlp("python3", "python3", server_script, NULL);
                _exit(1);
            } else if (pid > 0) {
                g_server_pid = pid;
            }

            // Wait up to 5s for server to start
            for (int i = 0; i < 50; i++) {
                if (is_port_open(SERVER_PORT)) break;
                usleep(100000);
            }
        }

        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];

        StudioAppDelegate *delegate = [[StudioAppDelegate alloc] init];
        [app setDelegate:delegate];
        setup_menu(delegate);

        [app run];
    }
    return 0;
}