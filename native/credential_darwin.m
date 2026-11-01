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
int marxCredentialKey(const char *account, unsigned char *key) {
 CFMutableDictionaryRef query = credentialQuery(account);
 CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
 CFTypeRef result = NULL;
 OSStatus status = SecItemCopyMatching(query, &result);
 if (status == errSecItemNotFound) {
  status = SecRandomCopyBytes(kSecRandomDefault, 32, key);
  if (status == errSecSuccess) {
   CFDictionaryRemoveValue(query, kSecReturnData);
   CFDataRef data = CFDataCreate(NULL, key, 32);
   CFDictionarySetValue(query, kSecValueData, data);
   CFDictionarySetValue(query, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly);
   status = SecItemAdd(query, NULL);
   CFRelease(data);
   if (status == errSecDuplicateItem) { CFRelease(query); return marxCredentialKey(account, key); }
  }
 } else if (status == errSecSuccess) {
  if (CFGetTypeID(result) != CFDataGetTypeID() || CFDataGetLength(result) != 32) status = errSecDecode;
  else memcpy(key, CFDataGetBytePtr(result), 32);
 }
 if (result) CFRelease(result);
 CFRelease(query);
 return (int)status;
}
int marxDeleteCredentialKey(const char *account) {
 CFMutableDictionaryRef query = credentialQuery(account);
 OSStatus status = SecItemDelete(query);
 CFRelease(query);
 return (int)status;
}
