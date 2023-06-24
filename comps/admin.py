from django.contrib import admin
from import_export.admin import ImportExportModelAdmin
from .models import SharesModel, UsersModel
from import_export import resources


class SharesModelResource(resources.ModelResource):
    class Meta:
        model = SharesModel


class UsersModelResource(resources.ModelResource):
    class Meta:
        model = UsersModel


class SharesModelAdmin(ImportExportModelAdmin):
    resource_class = SharesModelResource
    list_display = ['epic', 'shares', 'purchase_price']
    ordering = ['epic']


class UsersModelAdmin(ImportExportModelAdmin):
    resource_class = UsersModelResource
    list_display = ['firstname', 'lastname']
    filter_horizontal = ['ftse_id']
    
    def __str__(self):
        return f'{self.firstname} {self.lastname}'  


admin.site.register(SharesModel, SharesModelAdmin)
admin.site.register(UsersModel, UsersModelAdmin)

