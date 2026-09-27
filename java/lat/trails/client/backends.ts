import {
  CreateCollectionRequestSchema,
  CreateCollectionResponseSchema,
  DataService,
  GetCollectionRequestSchema,
  GetCollectionResponseSchema,
  GetCurrentUserRequestSchema,
  GetCurrentUserResponseSchema,
  GetSharingRequestSchema,
  GetSharingResponseSchema,
  ListCollectionsRequestSchema,
  ListCollectionsResponseSchema,
  SaveRequestSchema,
  SaveResponseSchema,
  SetSharingRequestSchema,
  SetSharingResponseSchema,
} from 'trails_lat/proto/data_pb';

export const BACKENDS = {
  'lat.trails.DataService': {
    service: DataService,
    methods: {
      createCollection: [CreateCollectionRequestSchema, CreateCollectionResponseSchema],
      getCollection: [GetCollectionRequestSchema, GetCollectionResponseSchema],
      getCurrentUser: [GetCurrentUserRequestSchema, GetCurrentUserResponseSchema],
      getSharing: [GetSharingRequestSchema, GetSharingResponseSchema],
      listCollections: [ListCollectionsRequestSchema, ListCollectionsResponseSchema],
      save: [SaveRequestSchema, SaveResponseSchema],
      setSharing: [SetSharingRequestSchema, SetSharingResponseSchema],
    },
  },
} as const;
