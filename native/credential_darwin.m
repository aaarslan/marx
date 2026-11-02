#include "credential_darwin.h"
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <string.h>
#import <LocalAuthentication/LocalAuthentication.h>

static CFMutableDictionaryRef credentialQuery(const char *account) {
 CFMutableDictionaryRef query = CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
 CFStringRef name = CFStringCreateWithCString(NULL, account, kCFStringEncodingUTF8);
 CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
 CFDictionarySetValue(query, kSecAttrService, CFSTR("com.marx.scanner.credentials"));
 CFDictionarySetValue(query, kSecAttrAccount, name);
 LAContext *context = [[LAContext alloc] init];
 context.interactionNotAllowed = YES;
 CFDictionarySetValue(query, kSecUseAuthenticationContext, context);
 [context release];
 CFRelease(name);
 return query;
}
int marxReadCredentialKey(const char *account, unsigned char *key) {
 CFMutableDictionaryRef query = credentialQuery(account);
 CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
 CFTypeRef result = NULL;
 OSStatus status = SecItemCopyMatching(query, &result);
 if (status == errSecSuccess) {
  if (CFGetTypeID(result) != CFDataGetTypeID() || CFDataGetLength(result) != 32) status = errSecDecode;
  else memcpy(key, CFDataGetBytePtr(result), 32);
 }
 if (result) CFRelease(result);
 CFRelease(query);
 return (int)status;
}
int marxStoreCredentialKey(const char *account, const unsigned char *key, int length) {
 CFMutableDictionaryRef query = credentialQuery(account);
 CFDataRef data = CFDataCreate(NULL, key, length);
 CFDictionarySetValue(query, kSecValueData, data);
 CFDictionarySetValue(query, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly);
 OSStatus status = SecItemAdd(query, NULL);
 CFRelease(data);
 CFRelease(query);
 return (int)status;
}
int marxCredentialStorageStatus(void) {
 CFMutableDictionaryRef query = credentialQuery("__availability__");
 OSStatus status = SecItemCopyMatching(query, NULL);
 CFRelease(query);
 return status == errSecSuccess || status == errSecItemNotFound ? 0 : (int)status;
}
int marxDeleteCredentialKey(const char *account) {
 CFMutableDictionaryRef query = credentialQuery(account);
 OSStatus status = SecItemDelete(query);
 CFRelease(query);
 return (int)status;
}

int marxDisableCredentialInteraction(void) {
 return (int)SecKeychainSetUserInteractionAllowed(false);
}
