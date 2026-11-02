#include <stdlib.h>
int marxReadCredentialKey(const char *account, unsigned char *key);
int marxStoreCredentialKey(const char *account, const unsigned char *key, int length);
int marxDeleteCredentialKey(const char *account);
int marxCredentialStorageStatus(void);
int marxDisableCredentialInteraction(void);
