from pulumi import Output, ResourceOptions
from pulumi_gcp import artifactregistry, compute, projects, secretmanager, serviceaccount

db_authorization = secretmanager.Secret(
    "db-authorization",
    secret_id="db-authorization",
    replication=secretmanager.SecretReplicationArgs(auto=secretmanager.SecretReplicationAutoArgs()),
)

frontend_account = serviceaccount.Account(
    "frontend",
    account_id="frontend",
)

importer_account = serviceaccount.Account(
    "importer",
    account_id="importer",
)

projects.IAMBinding(
    "artifact-access",
    project="trailcatalog",
    role="roles/artifactregistry.reader",
    members=[
        frontend_account.email.apply(lambda name: f"serviceAccount:{name}"),
        importer_account.email.apply(lambda name: f"serviceAccount:{name}"),
    ],
)

projects.IAMBinding(
    "secrets-access",
    project="trailcatalog",
    role="roles/secretmanager.secretAccessor",
    members=[
        frontend_account.email.apply(lambda name: f"serviceAccount:{name}"),
        importer_account.email.apply(lambda name: f"serviceAccount:{name}"),
    ],
)

registry = artifactregistry.Repository(
        "containers",
        repository_id="containers",
        format="DOCKER",
        location="us-west1",
        cleanup_policies=[
            artifactregistry.RepositoryCleanupPolicyArgs(
                id="delete-untagged",
                action="DELETE",
                condition=artifactregistry.RepositoryCleanupPolicyConditionArgs(
                    tag_state="UNTAGGED",
                    older_than=f"{14 * 24 * 60 * 60}s",
                ),
            ),
            # KEEP wins over DELETE, so each image keeps a few versions to roll back to.
            artifactregistry.RepositoryCleanupPolicyArgs(
                id="keep-recent",
                action="KEEP",
                most_recent_versions=artifactregistry.RepositoryCleanupPolicyMostRecentVersionsArgs(
                    keep_count=2,
                ),
            ),
        ],
)

