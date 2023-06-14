from django.contrib import admin
from import_export.admin import ImportExportModelAdmin
from .models import Mesi_model


@admin.register(Mesi_model)
class ViewAdmin(ImportExportModelAdmin):
    exclude = ("id",)
    list_display = ["company"]
